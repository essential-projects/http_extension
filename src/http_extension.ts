import {runtime} from '@essential-projects/foundation';
import {HttpExtension as BaseHttpExtension} from '@essential-projects/http_node';
import {IIdentity, IIdentityService} from '@essential-projects/iam_contracts';
import {IMessageBusAdapter} from '@essential-projects/messagebus_contracts';

import {ExecutionContext} from '@process-engine/process_engine_contracts';

import {Container, IInstanceWrapper} from 'addict-ioc';

import * as bodyParser from 'body-parser';
import * as compression from 'compression';
import * as busboy from 'connect-busboy';
import * as cookieParser from 'cookie-parser';
import * as cors from 'cors';
import * as debug from 'debug';
import * as helmet from 'helmet';
import * as http from 'http';

const debugInfo: debug.IDebugger = debug('http_extension:info');

export class HttpExtension extends BaseHttpExtension {

  private _messageBusAdapter: IMessageBusAdapter = undefined;
  private _identityService: IIdentityService = undefined;
  private _httpServer: http.Server = undefined;

  public config: any = undefined;

  private temporaryRedirectCode: number = 307;
  private forbiddenErrorCode: number = 403;

  constructor(container: Container<IInstanceWrapper<any>>,
              messageBusAdapter: IMessageBusAdapter,
              identityService: IIdentityService) {
    super(container);

    this._messageBusAdapter = messageBusAdapter;
    this._identityService = identityService;
  }

  private get messageBusAdapter(): IMessageBusAdapter {
    return this._messageBusAdapter;
  }

  private get identityService(): IIdentityService {
    return this._identityService;
  }

  public initializeAppExtensions(app: any): void {
    this._httpServer = http.createServer(app);
  }

  public initializeMiddlewareBeforeRouters(app: any): void {
    app.use(busboy());
    app.use(compression());
    const urlEncodedOpts: any = {
      extended: true,
    };
    if (this.config && this.config.parseLimit) {
      urlEncodedOpts.limit = this.config.parseLimit;
    }
    app.use(bodyParser.urlencoded(urlEncodedOpts));
    app.use(cookieParser());
    app.use(this.extractToken.bind(this));

    if (!this.config.disableCors) {
      app.use(cors());
    }

    // securing http headers with helmet
    app.use(helmet.hidePoweredBy());
    // app.use(helmet.ieNoOpen());
    app.use(helmet.noSniff());
    app.use(helmet.frameguard());
    // https://github.com/helmetjs/x-xss-protection
    app.use(helmet.xssFilter());

    if (this.config.csp) {
      app.use(helmet.contentSecurityPolicy(this.config.csp));
    }
  }

  private async extractToken(req: any, res: any, next: Function): Promise<void> {
      req.token = null;
      let bearerToken: string;
      const bearerHeader: string = req.headers.authorization;

      // first try auth header
      if (typeof bearerHeader !== 'undefined') {
          const bearer: Array<string> = bearerHeader.split(' ');
          bearerToken = bearer[1];
      } else if (req.cookies.token) {
          // extract token from cookie
          bearerToken = req.cookies.token;
      }

      let context: ExecutionContext = null;
      try {
          const identity: IIdentity = await this.identityService.getIdentity(bearerToken);
          context = new ExecutionContext(identity);
      } catch (err) {
        debugInfo('context can not be generated - token invalid');

        // Remove token
        res.cookie('token', '');

        let doRefresh: boolean = false;
        if (this.config.routeConfiguration) {
          Object.keys(this.config.routeConfiguration).forEach((routeNeedle: string) => {
            if (req.url.match(new RegExp(`^${routeNeedle.replace(/\//g, '\\/').replace(/\*/g, '.{0,}')}$`, 'i'))) {
              doRefresh = this.config.routeConfiguration[routeNeedle].refreshOnInvalidToken;
            }
          });
        }

        if (doRefresh) {
          res.header['Refresh'] = `0;url=${req.url}`;
          res.status(this.temporaryRedirectCode);
        } else {
          res.status(this.forbiddenErrorCode).json({ error: err.message });
        }
      }

      if (context) {
        req.context = context;
      }
      next();
  }

  public start(): Promise<any> {
    return new Promise((resolve: Function, reject: Function): void => {
      this.messageBusAdapter.start(this._httpServer);
      this._server = this._httpServer.listen(this.config.server.port, this.config.server.host, () => {

        runtime.invokeAsPromiseIfPossible(this.onStarted, this)
          .then((result: any) => {
            resolve(result);
          })
          .catch((error: Error) => {
            reject(error);
          });
      });

    });
  }
}
