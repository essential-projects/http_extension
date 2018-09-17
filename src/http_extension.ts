import {HttpExtension as BaseHttpExtension} from '@essential-projects/http_node';

import {IContainer, IInstanceWrapper} from 'addict-ioc';

import * as bodyParser from 'body-parser';
import * as compression from 'compression';
import * as busboy from 'connect-busboy';
import * as cookieParser from 'cookie-parser';
import * as cors from 'cors';
import * as helmet from 'helmet';

export class HttpExtension extends BaseHttpExtension {

  public config: any = undefined;

  constructor(container: IContainer<IInstanceWrapper<any>>) {
    super(container);
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

}
