import { IContainer, IInstanceWrapper } from 'addict-ioc';

import * as bodyParser from 'body-parser';
import * as compression from 'compression';
import * as busboy from 'connect-busboy';
import * as cookieParser from 'cookie-parser';
import * as cors from 'cors';
import * as Express from 'express';
import * as helmet from 'helmet';
import * as http from 'http';

import {routerDiscoveryTag, socketEndpointDiscoveryTag} from '@essential-projects/bootstrapper_contracts';
import {defaultSocketNamespace, IHttpExtension, IHttpRouter, IHttpSocketEndpoint} from '@essential-projects/http_contracts';
import {IHttpSocketAdapter} from '@essential-projects/http_socket_adapter_contracts';
import {IEndpointSocketScope} from '@essential-projects/websocket_contracts';

import {errorHandler} from './error_handler';

type SocketEndpointCollection = { [socketName: string]: IHttpSocketEndpoint };

export class HttpExtension implements IHttpExtension {

  private _container: IContainer<IInstanceWrapper<any>> = undefined;
  private _httpSocketAdapter: IHttpSocketAdapter = undefined;
  private _routers: any = {};
  private _socketEndpoints: SocketEndpointCollection = {};
  private _app: Express.Application = undefined;
  protected _httpServer: http.Server = undefined;
  protected _socketServer: SocketIO.Server = undefined;

  public config: any = undefined;

  constructor(container: IContainer<IInstanceWrapper<any>>, httpSocketAdapter: IHttpSocketAdapter) {
    this._container = container;
    this._httpSocketAdapter = httpSocketAdapter;
  }

  public get routers(): any {
    return this._routers;
  }

  public get socketEndpoints(): SocketEndpointCollection {
    return this._socketEndpoints;
  }

  public get container(): IContainer<IInstanceWrapper<any>> {
    return this._container;
  }

  public get httpSocketAdapter(): IHttpSocketAdapter {
    return this._httpSocketAdapter;
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
    await this.initializeSocketAdapter();

    await this.invokeAsPromiseIfPossible(this.initializeAppExtensions, this, this.app as any);
    this.initializeBaseMiddleware(this.app);
    await this.invokeAsPromiseIfPossible(this.initializeMiddlewareBeforeRouters, this, this.app as any);
    await this.initializeRouters();
    await this.invokeAsPromiseIfPossible(this.initializeMiddlewareAfterRouters, this, this.app as any);

    await this.initializeSocketEndpoints();
  }

  protected async initializeSocketAdapter(): Promise<void> {
      await this.httpSocketAdapter.initializeAdapter(this.httpServer);
  }

  protected initializeServer(): void {
    this._httpServer = (http as any).Server(this.app);
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

    const routerIsNotRegistered: boolean = !this.container.isRegistered(routerName);
    if (routerIsNotRegistered) {
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

    const socketEndpointIsNotRegistered: boolean = !this.container.isRegistered(socketEndpointName);
    if (socketEndpointIsNotRegistered) {
      throw new Error(`There is no socket endpoint registered for key '${socketEndpointName}'`);
    }

    const socketEndpointInstance: IHttpSocketEndpoint = await this.container.resolveAsync<IHttpSocketEndpoint>(socketEndpointName);

    const socketEndpointHasNamespace: boolean = !!socketEndpointInstance.namespace && socketEndpointInstance.namespace !== '';
    const namespaceIdentifier: string = socketEndpointHasNamespace
      ? socketEndpointInstance.namespace
      : defaultSocketNamespace;

    const namespace: IEndpointSocketScope = this.httpSocketAdapter.getNamespace(namespaceIdentifier);

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
    await this._closeSocketEndpoints();
    await this._closeHttpEndpoints();
    await this._closeHttpServer();
  }

  private async _closeSocketEndpoints(): Promise<void> {

    // Closes active connections
    await this.httpSocketAdapter.dispose();

    for (const socketName in this.socketEndpoints) {
      const socketEndpoint: IHttpSocketEndpoint = this.socketEndpoints[socketName];
      await this.invokeAsPromiseIfPossible(socketEndpoint.dispose, socketEndpoint);
    }
  }

  private async _closeHttpEndpoints(): Promise<void> {

    for (const routerName in this.routers) {
      const router: IHttpRouter = this.routers[routerName];
      await this.invokeAsPromiseIfPossible(router.dispose, router);
    }
  }

  private async _closeHttpServer(): Promise<void> {

    await new Promise(async(resolve: Function, reject: Function): Promise<void> => {
      if (this.httpServer) {
        this.httpServer.close(() => {
        resolve();
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

  protected initializeMiddlewareAfterRouters(app: Express.Application): Promise<any> | any {
    app.use(errorHandler);
  }

  protected filterRouters(routerNames: Array<string>): Promise<Array<string>> | Array<string> {
    return routerNames;
  }

  protected onStarted(): Promise<any> | any { return; }

  protected initializeBaseMiddleware(app: Express.Application): void {

    const options: { [optionName: string]: any } = {};
    if (this.config && this.config.parseLimit) {
      options.limit = this.config.parseLimit;
    }

    options.verify = (req: Request | any, res: Response, buf: any): void => {
      req.rawBody = buf.toString();
    };
    app.use(bodyParser.json(options));
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
