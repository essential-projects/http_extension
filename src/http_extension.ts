import {IContainer, IInstanceWrapper} from 'addict-ioc';

import * as bodyParser from 'body-parser';
import * as compression from 'compression';
import * as busboy from 'connect-busboy';
import * as cookieParser from 'cookie-parser';
import * as cors from 'cors';
import * as Express from 'express';
import * as helmet from 'helmet';
import * as http from 'http';
import * as socketIo from 'socket.io';

import {routerDiscoveryTag, socketEndpointDiscoveryTag} from '@essential-projects/bootstrapper_contracts';
import {defaultSocketNamespace, IHttpExtension, IHttpRouter, IHttpSocketEndpoint} from '@essential-projects/http_contracts';

import {errorHandler} from './error_handler';

export class HttpExtension implements IHttpExtension {

  private _container: IContainer<IInstanceWrapper<any>> = undefined;
  private _routers: any = {};
  private _socketEndpoints: any = {};
  private _app: Express.Application = undefined;
  protected _httpServer: http.Server = undefined;
  protected _socketServer: SocketIO.Server = undefined;

  public config: any = undefined;

  constructor(container: IContainer<IInstanceWrapper<any>>) {
    this._container = container;
  }

  public get routers(): any {
    return this._routers;
  }

  public get socketEndpoints(): any {
    return this._socketEndpoints;
  }

  public get container(): IContainer<IInstanceWrapper<any>> {
    return this._container;
  }

  public get app(): Express.Application {
    if (!this._app) {
      this._app = Express();
    }

    return this._app;
  }

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
    this._httpServer = (http as any).Server(this.app);
    this._socketServer = socketIo(this.httpServer);
  }

  protected async initializeSocketEndpoints(): Promise<void> {

    const allSocketEndpointNames: Array<string> = this.container.getKeysByTags(socketEndpointDiscoveryTag);

    for (const socketEndpointName of allSocketEndpointNames) {
      await this.initializeSocketEndpoint(socketEndpointName);
    }
  }

  protected async initializeRouters(): Promise<void> {

    let routerNames: Array<string>;

    const allRouterNames: Array<string> = this.container.getKeysByTags(routerDiscoveryTag);

    this.container.validateDependencies();

    const filteredRouterNames: Array<string> = await this.invokeAsPromiseIfPossible(this.filterRouters, this, allRouterNames);

    if (typeof filteredRouterNames === 'undefined' || filteredRouterNames === null) {
      routerNames = allRouterNames;
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

    if (!this.container.isRegistered(routerName)) {

      throw new Error(`There is no router registered for key '${routerName}'`);
    }

    const routerInstance: IHttpRouter = await this.container.resolveAsync<IHttpRouter>(routerName);

    this.bindRoute(routerInstance);
    this.routers[routerName] = routerInstance;
  }

  protected bindRoute(routerInstance: any): void {

    const shieldingRouter: Express.Router = Express.Router();

    shieldingRouter.use(`/${routerInstance.baseRoute}/`, routerInstance.router);

    this.app.use('/', shieldingRouter); // TODO (sm): this still needs a manual integration test
  }

  protected async initializeSocketEndpoint(socketEndpointName: string): Promise<void> {

    if (!this.container.isRegistered(socketEndpointName)) {
      throw new Error(`There is no socket endpoint registered for key '${socketEndpointName}'`);
    }

    const socketEndpointInstance: IHttpSocketEndpoint = await this.container.resolveAsync<IHttpSocketEndpoint>(socketEndpointName);

    const socketEndpointHasNamespace: boolean = !!socketEndpointInstance.namespace && socketEndpointInstance.namespace !== '';
    const namespace: SocketIO.Namespace = socketEndpointHasNamespace
      ? this._socketServer.of(socketEndpointInstance.namespace)
      : this._socketServer.of(defaultSocketNamespace);

    await socketEndpointInstance.initializeEndpoint(namespace);

    this.socketEndpoints[socketEndpointName] = socketEndpointInstance;
  }

  public async start(): Promise<any> {
    return new Promise(async(resolve: Function, reject: Function): Promise<any> => {

      this._httpServer = this.httpServer.listen(this.config.server.port, this.config.server.host, async() => {

        try {
          const onStartedResult: any = await this.invokeAsPromiseIfPossible(this.onStarted, this);
          resolve(onStartedResult);
        } catch (error) {
          reject(error);
        }
      });

    });
  }

  public async close(): Promise<void> {

    for (const routerName in this.routers) {
      const router: IHttpRouter = this.routers[routerName];
      await this.invokeAsPromiseIfPossible(router.dispose, router);
    }

    await new Promise(async(resolve: Function, reject: Function): Promise<void> => {

      const connectedSockets: Array<socketIo.Socket> = Object.values(this.socketServer.of('/').connected);

      connectedSockets.forEach((socket: socketIo.Socket): void => {
        socket.disconnect(true);
      });

      if (this.httpServer) {
        this._socketServer.close(() => {
          this.httpServer.close(() => {
            resolve();
          });
        });
      }
    });
  }

  protected initializeAppExtensions(app: Express.Application): Promise<any> | any { return; }

  protected initializeMiddlewareBeforeRouters(app: Express.Application): Promise<any> | any {
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

  protected initializeMiddlewareAfterRouters(app: Express.Application): Promise<any> | any {
    app.use(errorHandler);
  }

  protected filterRouters(routerNames: Array<string>): Promise<Array<string>> | Array<string> {
    return routerNames;
  }

  protected onStarted(): Promise<any> | any { return; }

  protected initializeBaseMiddleware(app: Express.Application): void {

    const opts: any = {};
    if (this.config && this.config.parseLimit) {
      opts.limit = this.config.parseLimit;
    }
    app.use(bodyParser.json(opts));
  }

  // Taken from the foundation, to remove the need for that package.
  protected async invokeAsPromiseIfPossible(functionToInvoke: any, invocationContext: any, invocationParameter?: Array<any>): Promise<any> {

    const isValidFunction: boolean = typeof functionToInvoke === 'function';

    if (!isValidFunction) {
      return;
    }

    return await functionToInvoke.call(invocationContext, invocationParameter);
  }
}
