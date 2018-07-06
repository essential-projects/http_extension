import {runtime} from '@essential-projects/foundation';
import {HttpExtension as BaseHttpExtension} from '@essential-projects/http_node';
import {IMessageBusAdapter} from '@essential-projects/messagebus_contracts';

import {Container, IInstanceWrapper} from 'addict-ioc';

import * as bodyParser from 'body-parser';
import * as compression from 'compression';
import * as busboy from 'connect-busboy';
import * as cookieParser from 'cookie-parser';
import * as cors from 'cors';
import * as helmet from 'helmet';
import * as http from 'http';

export class HttpExtension extends BaseHttpExtension {

  private _messageBusAdapter: IMessageBusAdapter = undefined;
  private _httpServer: http.Server = undefined;

  public config: any = undefined;

  constructor(container: Container<IInstanceWrapper<any>>,
              messageBusAdapter: IMessageBusAdapter) {
    super(container);

    this._messageBusAdapter = messageBusAdapter;
  }

  private get messageBusAdapter(): IMessageBusAdapter {
    return this._messageBusAdapter;
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
