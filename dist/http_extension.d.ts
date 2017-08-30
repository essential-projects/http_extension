import { HttpExtension as BaseHttpExtension } from '@process-engine-js/http_node';
import { Container, IInstanceWrapper } from 'addict-ioc';
import { IIamService } from '@process-engine-js/core_contracts';
export declare class HttpExtension extends BaseHttpExtension {
    private _messageBusAdapter;
    private _iamService;
    private _httpServer;
    config: any;
    constructor(container: Container<IInstanceWrapper<any>>, messageBusAdapter: any, iamService: IIamService);
    private readonly messageBusAdapter;
    private readonly iamService;
    initializeAppExtensions(app: any): void;
    initializeMiddlewareBeforeRouters(app: any): void;
    private extractToken(req, res, next);
    start(): Promise<any>;
}
