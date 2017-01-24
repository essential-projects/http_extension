import { HttpExtension as BaseHttpExtension } from '@5minds/http';
import { DependencyInjectionContainer } from '@5minds/addict-ioc';
import { IIamService } from '@process-engine-js/iam_contracts';
export declare class HttpExtension extends BaseHttpExtension {
    private _fayeClient;
    private _iamService;
    private _httpServer;
    config: any;
    constructor(container: DependencyInjectionContainer, fayeClient: any, iamService: IIamService);
    private readonly fayeClient;
    private readonly iamService;
    initialize(): Promise<void>;
    initializeAppExtensions(app: any): void;
    initializeMiddlewareBeforeRouters(app: any): void;
    private extractToken(req, res, next);
    start(): Promise<any>;
}
