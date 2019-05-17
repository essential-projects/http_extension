/* eslint-disable no-return-await */
import {IContainer, IInstanceWrapper} from 'addict-ioc';

import * as bodyParser from 'body-parser';
import * as compression from 'compression';
import * as busboy from 'connect-busboy';
import * as cookieParser from 'cookie-parser';
import * as cors from 'cors';
import * as express from 'express';
import * as helmet from 'helmet';
import * as http from 'http';
import * as socketIo from 'socket.io';

import {routerDiscoveryTag, socketEndpointDiscoveryTag} from '@essential-projects/bootstrapper_contracts';
import {
  IHttpExtension, IHttpRouter, IHttpSocketEndpoint, defaultSocketNamespace,
} from '@essential-projects/http_contracts';

import {errorHandler} from './error_handler';

type SocketEndpointCollection = {[socketName: string]: IHttpSocketEndpoint};

export class HttpExtension implements IHttpExtension {

  public config: any = undefined;

  protected _httpServer: http.Server = undefined;
  protected _socketServer: SocketIO.Server = undefined;

  private _container: IContainer<IInstanceWrapper<any>> = undefined;
  private _routers: any = {};
  private _socketEndpoints: SocketEndpointCollection = {};
  private _app: express.Application = undefined;

  constructor(container: IContainer<IInstanceWrapper<any>>) {
    this._container = container;
  }

  // --------------
  // TODO: Check if it is really necessary to expose all this stuff publicy.
  public get routers(): any {
    return this._routers;
  }

  public get socketEndpoints(): SocketEndpointCollection {
    return this._socketEndpoints;
  }

  public get container(): IContainer<IInstanceWrapper<any>> {
    return this._container;
  }

  public get app(): express.Application {
    if (!this._app) {
      this._app = express();
    }

    return this._app;
  }
  // ------------------

  public get httpServer(): http.Server {
    return this._httpServer;
  }

  public get socketServer(): SocketIO.Server {
    return this._socketServer;
  }

  public async initialize(): Promise<void> {
    await this.initializeServer();

    await this.invokeAsPromiseIfPossible(this.initializeAppExtensions, this, this.app as any);
    this.initializeBaseMiddleware(this.app);
    await this.invokeAsPromiseIfPossible(this.initializeMiddlewareBeforeRouters, this, this.app as any);
    await this.initializeRouters();
    await this.invokeAsPromiseIfPossible(this.initializeMiddlewareAfterRouters, this, this.app as any);

    await this.initializeSocketEndpoints();
  }

  protected initializeServer(): void {
    // This notation comes from an external module, which we have no control over.
    // eslint-disable-next-line
    this._httpServer = (http as any).Server(this.app);

    // TODO: The socket.io typings are currently very much outdated and do not contain the "handlePreflightRequest" option.
    // It is still functional, though.
    const corsMiddleware = cors(this.config.cors.options);
    this._socketServer = socketIo(this.httpServer as any, <any> {
      handlePreflightRequest: (req: any, res: any): void => {
        corsMiddleware(req, res, res.end);
      },
    });
  }

  protected async initializeSocketEndpoints(): Promise<void> {

    const allSocketEndpointNames = this.container.getKeysByTags(socketEndpointDiscoveryTag);

    for (const socketEndpointName of allSocketEndpointNames) {
      await this.initializeSocketEndpoint(socketEndpointName);
    }
  }

  protected async initializeRouters(): Promise<void> {

    let routerNames: Array<string>;

    const allRouterNames = this.container.getKeysByTags(routerDiscoveryTag);

    this.container.validateDependencies();

    // TODO: Check if this filtering is used anywhere and remove if it is not.
    const filteredRouterNames = await this.invokeAsPromiseIfPossible(this.filterRouters, this, allRouterNames);

    if (!filteredRouterNames) {
      routerNames = [];
    } else {

      if (!Array.isArray(filteredRouterNames)) {
        throw new Error('Filtered router names must be of type Array.');
      }

      routerNames = filteredRouterNames;
    }

    for (const routerName of routerNames) {
      await this.initializeRouter(routerName);
    }
  }

  protected async initializeRouter(routerName: string): Promise<void> {

    const routerIsNotRegistered = !this.container.isRegistered(routerName);
    if (routerIsNotRegistered) {
      throw new Error(`There is no router registered for key '${routerName}'`);
    }

    const routerInstance = await this.container.resolveAsync<IHttpRouter>(routerName);

    this.bindRoute(routerInstance);
    this.routers[routerName] = routerInstance;
  }

  protected bindRoute(routerInstance: any): void {

    // This notation comes from an external module, which we have no control over.
    // eslint-disable-next-line
    const shieldingRouter = express.Router();

    shieldingRouter.use(`/${routerInstance.baseRoute}/`, routerInstance.router);

    this.app.use('/', shieldingRouter);
  }

  protected async initializeSocketEndpoint(socketEndpointName: string): Promise<void> {

    const socketEndpointIsNotRegistered = !this.container.isRegistered(socketEndpointName);
    if (socketEndpointIsNotRegistered) {
      throw new Error(`There is no socket endpoint registered for key '${socketEndpointName}'`);
    }

    const socketEndpointInstance = await this.container.resolveAsync<IHttpSocketEndpoint>(socketEndpointName);

    const socketEndpointHasNamespace = !!socketEndpointInstance.namespace && socketEndpointInstance.namespace !== '';
    const namespace = socketEndpointHasNamespace
      ? this._socketServer.of(socketEndpointInstance.namespace)
      : this._socketServer.of(defaultSocketNamespace);

    await socketEndpointInstance.initializeEndpoint(namespace);

    this.socketEndpoints[socketEndpointName] = socketEndpointInstance;
  }

  public async start(): Promise<any> {
    return new Promise(async (resolve: Function, reject: Function): Promise<any> => {

      this._httpServer = this.httpServer.listen(this.config.server.port, this.config.server.host, async (): Promise<void> => {

        try {
          const onStartedResult = await this.invokeAsPromiseIfPossible(this.onStarted, this);
          resolve(onStartedResult);
        } catch (error) {
          reject(error);
        }
      });

    });
  }

  public async close(): Promise<void> {
    await this.closeSockets();
    await this.closeHttpEndpoints();
  }

  private async closeSockets(): Promise<void> {
    const connectedSockets: Array<socketIo.Socket> = Object.values(this.socketServer.of('/').connected);
    for (const socket of connectedSockets) {
      socket.disconnect(true);
    }

    for (const socketName in this.socketEndpoints) {
      const socketEndpoint: IHttpSocketEndpoint = this.socketEndpoints[socketName];
      await this.invokeAsPromiseIfPossible(socketEndpoint.dispose, socketEndpoint);
    }
  }

  private async closeHttpEndpoints(): Promise<void> {

    for (const routerName in this.routers) {
      const router = this.routers[routerName];
      await this.invokeAsPromiseIfPossible(router.dispose, router);
    }

    await new Promise(async (resolve: Function, reject: Function): Promise<void> => {
      if (this.httpServer) {
        this._socketServer.close((): void => {
          this.httpServer.close((): void => {
            resolve();
          });
        });
      }
    });
  }

  protected initializeAppExtensions(app: express.Application): Promise<any> | any { }

  protected initializeMiddlewareBeforeRouters(app: express.Application): Promise<any> | any {
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

    if (this.config.cors.enabled) {
      app.use(cors(this.config.cors.options));
    }

    // securing http headers with helmet
    app.use(helmet.hidePoweredBy());
    // app.use(helmet.ieNoOpen());
    app.use(helmet.noSniff());

    const frameguardOptions: any = this.config.frameguard || {};
    app.use(helmet.frameguard(frameguardOptions));
    // https://github.com/helmetjs/x-xss-protection
    app.use(helmet.xssFilter());

    if (this.config.csp) {
      app.use(helmet.contentSecurityPolicy(this.config.csp));
    }
  }

  protected initializeMiddlewareAfterRouters(app: express.Application): Promise<any> | any {
    app.use(errorHandler);
  }

  protected filterRouters(routerNames: Array<string>): Promise<Array<string>> | Array<string> {
    return routerNames;
  }

  protected onStarted(): Promise<any> | any { }

  protected initializeBaseMiddleware(app: express.Application): void {

    const options: {[optionName: string]: any} = {};
    if (this.config && this.config.parseLimit) {
      options.limit = this.config.parseLimit;
    }

    options.verify = (req: express.Request | any, res: express.Response, buf: any): void => {
      req.rawBody = buf.toString();
    };
    app.use(bodyParser.json(options));
  }

  // Taken from the foundation, to remove the need for that package.
  protected async invokeAsPromiseIfPossible(functionToInvoke: any, invocationContext: any, invocationParameter?: Array<any>): Promise<any> {

    const isValidFunction = typeof functionToInvoke === 'function';

    if (!isValidFunction) {
      return Promise.resolve();
    }

    return await functionToInvoke.call(invocationContext, invocationParameter);
  }

}
