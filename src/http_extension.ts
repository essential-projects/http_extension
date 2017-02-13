import {HttpExtension as BaseHttpExtension} from '@process-engine-js/http';
import {DependencyInjectionContainer} from 'addict-ioc';
import {IIamService} from '@process-engine-js/iam_contracts';
import {TokenType} from '@process-engine-js/core_contracts';
import {executeAsExtensionHookAsync as extensionHook} from '@process-engine-js/utils';

import * as BluebirdPromise from 'bluebird';
import * as busboy from 'connect-busboy';
import * as compression from 'compression';
import * as bodyParser from 'body-parser';
import * as cookieParser from 'cookie-parser';
import * as helmet from 'helmet';
import * as debug from 'debug';
import * as http from 'http';

const debugInfo = debug('http_extension:info');

export class HttpExtension extends BaseHttpExtension {

  private _fayeClient: any = undefined;
  private _iamService: any = undefined;
  private _httpServer: any = undefined;

  public config: any = undefined;

  constructor(container: DependencyInjectionContainer, fayeClient: any, iamService: IIamService) {
    super(container);

    this._fayeClient = fayeClient;
    this._iamService = iamService;
  }

  private get fayeClient(): any {
    return this._fayeClient;
  }

  private get iamService(): any {
    return this._iamService;
  }

  public async initialize(): Promise<void> {

    this.iamService.initialize();
    
    await super.initialize();
    debugInfo('initialized');
  }

  initializeAppExtensions(app) {
    this._httpServer = http.createServer(app);
    this.fayeClient.initialize(this._httpServer);
  }

  initializeMiddlewareBeforeRouters(app) {
    app.use(busboy());
    app.use(compression());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(cookieParser());
    app.use(this.extractToken.bind(this));

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
      }

      if (context) {
        req.context = context;
      }
      next();
  }

  public start(): Promise<any> {

    return new BluebirdPromise((resolve, reject) => {

      this._server = this._httpServer.listen(this.config.server.port, this.config.server.host, () => {
        console.log(`Started REST API ${this.config.server.host}:${this.config.server.port}`);

        // logger.info(`Started REST API ${this.config.server.host}:${this.config.server.port}`);

        extensionHook(this.onStarted, this)
          .then((result) => {
            resolve(result);
          })
          .catch((error) => {
            reject(error);
          });
      });

    }).then(() => {
      console.log('AJSKDHGLAKSJGDJHASGDJHAGSJK');
    });
  }
}
