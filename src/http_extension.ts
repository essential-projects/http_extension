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
  IHttpExtension,
  IHttpRouter,
  IHttpSocketEndpoint,
  defaultSocketNamespace,
} from '@essential-projects/http_contracts';

import {errorHandler} from './error_handler';

interface ISocketEndpointCollection {[socketName: string]: IHttpSocketEndpoint}

export class HttpExtension implements IHttpExtension {

  public config;

  public readonly app: express.Application;
  public readonly httpServer: http.Server;

  private container: IContainer<IInstanceWrapper<unknown>>;
  // eslint-disable-next-line @typescript-eslint/member-naming
  private _socketServer: SocketIO.Server;

  private routers = {};
  private socketEndpoints: ISocketEndpointCollection = {};

  constructor(container: IContainer<IInstanceWrapper<unknown>>) {
    this.container = container;

    this.app = express();
    // This notation comes from an external module, which we have no control over.
    // eslint-disable-next-line
    this.httpServer = (http as any).Server(this.app);
  }

  public get socketServer(): SocketIO.Server {
    return this._socketServer;
  }

  public async initialize(): Promise<void> {
    await this.initializeServer();
    await this.initializeAppExtensions();
    this.initializeBaseMiddleware();
    await this.initializeMiddlewareBeforeRouters();
    await this.initializeRouters();
    await this.initializeMiddlewareAfterRouters();

    await this.initializeSocketEndpoints();
  }

  public async start(): Promise<void> {
    return new Promise(async (resolve: Function, reject: Function): Promise<void> => {

      this.httpServer.listen(this.config.server.port, this.config.server.host, async (): Promise<void> => {

        try {
          await this.onStarted();
          resolve();
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

  protected initializeServer(): Promise<void> | void {

    const corsMiddleware = cors(this.config.cors.options);
    this._socketServer = socketIo(this.httpServer, {
      handlePreflightRequest: (req: express.Request, res: express.Response): void => {
        corsMiddleware(req, res, res.end);
      },
    });
  }

  // Parameter is required for inheritance, though inheriting this function is optional.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected initializeAppExtensions(): Promise<void> | void { }

  protected initializeBaseMiddleware(): void {

    const options = {
      limit: this.config?.parseLimit,
      verify: (req: express.Request, res: express.Response, buf: Buffer): void => {
        (req as any).rawBody = buf.toString(); // eslint-disable-line
      },
    };
    this.app.use(bodyParser.json(options));
  }

  protected initializeMiddlewareBeforeRouters(): Promise<void> | void {
    this.app.use(busboy());
    this.app.use(compression());

    const urlEncodedOptions = {
      limit: this.config?.parseLimit ?? undefined,
      extended: true,
    };

    this.app.use(bodyParser.urlencoded(urlEncodedOptions));
    this.app.use(cookieParser());

    if (this.config?.cors?.enabled) {
      this.app.use(cors(this.config.cors.options));
    }

    // securing http headers with helmet
    this.app.use(helmet.hidePoweredBy());
    this.app.use(helmet.noSniff());

    const frameguardOptions = this.config?.frameguard ?? {};
    this.app.use(helmet.frameguard(frameguardOptions));
    // https://github.com/helmetjs/x-xss-protection
    this.app.use(helmet.xssFilter());

    if (this.config.csp) {
      this.app.use(helmet.contentSecurityPolicy(this.config.csp));
    }
  }

  protected async initializeRouters(): Promise<void> {

    this.container.validateDependencies();

    const allRouterNames = this.container.getKeysByTags(routerDiscoveryTag);

    if (!Array.isArray(allRouterNames)) {
      throw new Error('Router names must be stored in an Array.');
    }

    for (const routerName of allRouterNames) {
      await this.initializeRouter(routerName);
    }
  }

  protected initializeMiddlewareAfterRouters(): Promise<void> | void {
    this.app.use(errorHandler);
  }

  protected async initializeSocketEndpoints(): Promise<void> {

    const allSocketEndpointNames = this.container.getKeysByTags(socketEndpointDiscoveryTag);

    for (const socketEndpointName of allSocketEndpointNames) {
      await this.initializeSocketEndpoint(socketEndpointName);
    }
  }

  protected onStarted(): Promise<void> | void { }

  private async initializeRouter(routerName: string): Promise<void> {

    const routerIsNotRegistered = !this.container.isRegistered(routerName);
    if (routerIsNotRegistered) {
      throw new Error(`There is no router registered for key '${routerName}'`);
    }

    const routerInstance = await this.container.resolveAsync<IHttpRouter>(routerName);

    this.bindRoute(routerInstance);
    this.routers[routerName] = routerInstance;
  }

  private bindRoute(routerInstance: IHttpRouter): void {

    // This notation comes from an external module, which we have no control over.
    // eslint-disable-next-line
    const shieldingRouter = express.Router();

    shieldingRouter.use(`/${routerInstance.baseRoute}/`, routerInstance.router);

    this.app.use('/', shieldingRouter);
  }

  private async initializeSocketEndpoint(socketEndpointName: string): Promise<void> {

    const socketEndpointIsNotRegistered = !this.container.isRegistered(socketEndpointName);
    if (socketEndpointIsNotRegistered) {
      throw new Error(`There is no socket endpoint registered for key '${socketEndpointName}'`);
    }

    const socketEndpointInstance = await this.container.resolveAsync<IHttpSocketEndpoint>(socketEndpointName);

    const socketEndpointHasNamespace = socketEndpointInstance?.namespace?.length > 0;
    const namespace = socketEndpointHasNamespace
      ? this.socketServer.of(socketEndpointInstance.namespace)
      : this.socketServer.of(defaultSocketNamespace);

    await socketEndpointInstance.initializeEndpoint(namespace);

    this.socketEndpoints[socketEndpointName] = socketEndpointInstance;
  }

  private async closeSockets(): Promise<void> {
    const connectedSockets = Object.values(this.socketServer.of('/').connected);
    for (const socket of connectedSockets) {
      socket.disconnect(true);
    }

    const socketNames = Object.keys(this.socketEndpoints);
    for (const socketName of socketNames) {
      const socketEndpoint = this.socketEndpoints[socketName];
      await socketEndpoint.dispose();
    }
  }

  private async closeHttpEndpoints(): Promise<void> {

    const routerNames = Object.keys(this.routers);
    for (const routerName of routerNames) {
      const router = this.routers[routerName];
      await router.dispose();
    }

    await new Promise(async (resolve: Function): Promise<void> => {
      if (this.httpServer) {
        this.socketServer.close((): void => {
          this.httpServer.close((): void => {
            resolve();
          });
        });
      }
    });
  }

}
