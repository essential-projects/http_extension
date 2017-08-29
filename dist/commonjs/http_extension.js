"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const http_node_1 = require("@process-engine-js/http_node");
const core_contracts_1 = require("@process-engine-js/core_contracts");
const utils_1 = require("@process-engine-js/utils");
const BluebirdPromise = require("bluebird");
const busboy = require("connect-busboy");
const compression = require("compression");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const debug = require("debug");
const http = require("http");
const cors = require("cors");
const debugInfo = debug('http_extension:info');
class HttpExtension extends http_node_1.HttpExtension {
    constructor(container, messageBusAdapter, iamService) {
        super(container);
        this._messageBusAdapter = undefined;
        this._iamService = undefined;
        this._httpServer = undefined;
        this.config = undefined;
        this._messageBusAdapter = messageBusAdapter;
        this._iamService = iamService;
    }
    get messageBusAdapter() {
        return this._messageBusAdapter;
    }
    get iamService() {
        return this._iamService;
    }
    async initialize() {
        this.iamService.initialize();
        await super.initialize();
        debugInfo('initialized');
    }
    initializeAppExtensions(app) {
        this._httpServer = http.createServer(app);
        this.messageBusAdapter.initialize(this._httpServer);
    }
    initializeMiddlewareBeforeRouters(app) {
        app.use(busboy());
        app.use(compression());
        const urlEncodedOpts = {
            extended: true
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
        app.use(helmet.hidePoweredBy());
        app.use(helmet.noSniff());
        app.use(helmet.frameguard());
        app.use(helmet.xssFilter());
        const csp = this.config.csp;
        if (csp) {
            app.use(helmet.contentSecurityPolicy(csp));
        }
    }
    async extractToken(req, res, next) {
        req.token = null;
        let bearerToken;
        const bearerHeader = req.headers.authorization;
        if (typeof bearerHeader !== 'undefined') {
            const bearer = bearerHeader.split(' ');
            bearerToken = bearer[1];
        }
        else if (req.cookies.token) {
            bearerToken = req.cookies.token;
        }
        let context = null;
        try {
            context = await this.iamService.resolveExecutionContext(bearerToken, core_contracts_1.TokenType.jwt);
        }
        catch (err) {
            debugInfo('context can not be generated - token invalid');
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
            }
            else {
                res.status(403).json({ error: err.message });
            }
        }
        if (context) {
            req.context = context;
        }
        next();
    }
    start() {
        return new BluebirdPromise((resolve, reject) => {
            this._server = this._httpServer.listen(this.config.server.port, this.config.server.host, () => {
                console.log(`Started REST API ${this.config.server.host}:${this.config.server.port}`);
                utils_1.executeAsExtensionHookAsync(this.onStarted, this)
                    .then((result) => {
                    resolve(result);
                })
                    .catch((error) => {
                    reject(error);
                });
            });
        }).then(() => {
            console.log('Backend started successfully');
        });
    }
}
exports.HttpExtension = HttpExtension;

//# sourceMappingURL=http_extension.js.map
