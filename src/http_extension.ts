import { IIamService, TokenType } from '@essential-projects/core_contracts';
import {runtime} from '@essential-projects/foundation';
import {HttpExtension as BaseHttpExtension} from '@essential-projects/http_node';
import {IMessageBusAdapter} from '@essential-projects/messagebus_contracts';
import {Container, IInstanceWrapper} from 'addict-ioc';

import * as bodyParser from 'body-parser';
import * as compression from 'compression';
import * as busboy from 'connect-busboy';
import * as cookieParser from 'cookie-parser';
import * as cors from 'cors';
import * as debug from 'debug';
import * as helmet from 'helmet';
import * as http from 'http';

const debugInfo = debug('http_extension:info');

export class HttpExtension extends BaseHttpExtension {

  private _messageBusAdapter: IMessageBusAdapter = undefined;
  private _iamService: IIamService = undefined;
  private _httpServer: any = undefined;

  public config: any = undefined;

  constructor(container: Container<IInstanceWrapper<any>>, messageBusAdapter: IMessageBusAdapter, iamService: IIamService) {
    super(container);

    this._messageBusAdapter = messageBusAdapter;
    this._iamService = iamService;
  }

  private get messageBusAdapter(): IMessageBusAdapter {
    return this._messageBusAdapter;
  }

  private get iamService(): any {
    return this._iamService;
  }

  public initializeAppExtensions(app) {
    this._httpServer = http.createServer(app);
  }

  public initializeMiddlewareBeforeRouters(app) {
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
    const csp = this.config.csp;
    if (csp) {
      app.use(helmet.contentSecurityPolicy(csp));
    }
  }

  private async extractToken(req: any, res: any, next: any) {
      req.token = null;
      let bearerToken;
      const bearerHeader = req.headers.authorization;

      // first try auth header
      if (typeof bearerHeader !== 'undefined') {
          const bearer = bearerHeader.split(' ');
          bearerToken = bearer[1];
      } else if (req.cookies.token) {
          // extract token from cookie
          bearerToken = req.cookies.token;
      }

      let context = null;
      try {
          context = await this.iamService.resolveExecutionContext(bearerToken, TokenType.jwt);
      } catch (err) {
        debugInfo('context can not be generated - token invalid');

        // Remove token
        res.cookie('token', '');

        let doRefresh = false;
        if (this.config.routeConfiguration) {
          Object.keys(this.config.routeConfiguration).forEach((routeNeedle) => {
            if (req.url.match(new RegExp('^' + routeNeedle.replace(/\//g, '\\/').replace(/\*/g, '.{0,}') + '$', 'i'))) {
              doRefresh = this.config.routeConfiguration[routeNeedle].refreshOnInvalidToken;
            }
          });
        }

        if (doRefresh) {
          res.header['Refresh'] = '0;url=' + req.url;
          res.status(307);
        } else {
          res.status(403).json({ error: err.message });
        }
      }

      if (context) {
        req.context = context;
      }
      next();
  }

  public start(): Promise<any> {
    return new Promise((resolve, reject) => {
      this.messageBusAdapter.start(this._httpServer);
      this._server = this._httpServer.listen(this.config.server.port, this.config.server.host, () => {

        runtime.invokeAsPromiseIfPossible(this.onStarted, this)
          .then((result) => {
            resolve(result);
          })
          .catch((error) => {
            reject(error);
          });
      });

    });
  }
}
