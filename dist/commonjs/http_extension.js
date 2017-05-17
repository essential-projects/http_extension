"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t;
    return { next: verb(0), "throw": verb(1), "return": verb(2) };
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = y[op[0] & 2 ? "return" : op[0] ? "throw" : "next"]) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [0, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var http_1 = require("@process-engine-js/http");
var core_contracts_1 = require("@process-engine-js/core_contracts");
var utils_1 = require("@process-engine-js/utils");
var BluebirdPromise = require("bluebird");
var busboy = require("connect-busboy");
var compression = require("compression");
var bodyParser = require("body-parser");
var cookieParser = require("cookie-parser");
var helmet = require("helmet");
var debug = require("debug");
var http = require("http");
var cors = require("cors");
var debugInfo = debug('http_extension:info');
var HttpExtension = (function (_super) {
    __extends(HttpExtension, _super);
    function HttpExtension(container, fayeClient, iamService) {
        var _this = _super.call(this, container) || this;
        _this._fayeClient = undefined;
        _this._iamService = undefined;
        _this._httpServer = undefined;
        _this.config = undefined;
        _this._fayeClient = fayeClient;
        _this._iamService = iamService;
        return _this;
    }
    Object.defineProperty(HttpExtension.prototype, "fayeClient", {
        get: function () {
            return this._fayeClient;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(HttpExtension.prototype, "iamService", {
        get: function () {
            return this._iamService;
        },
        enumerable: true,
        configurable: true
    });
    HttpExtension.prototype.initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.iamService.initialize();
                        return [4 /*yield*/, _super.prototype.initialize.call(this)];
                    case 1:
                        _a.sent();
                        debugInfo('initialized');
                        return [2 /*return*/];
                }
            });
        });
    };
    HttpExtension.prototype.initializeAppExtensions = function (app) {
        this._httpServer = http.createServer(app);
        this.fayeClient.initialize(this._httpServer);
    };
    HttpExtension.prototype.initializeMiddlewareBeforeRouters = function (app) {
        app.use(busboy());
        app.use(compression());
        app.use(bodyParser.urlencoded({ extended: true }));
        app.use(cookieParser());
        app.use(this.extractToken.bind(this));
        if (!this.config.disableCors) {
            app.use(cors());
        }
        app.use(helmet.hidePoweredBy());
        app.use(helmet.noSniff());
        app.use(helmet.frameguard());
        app.use(helmet.xssFilter());
        var csp = this.config.csp;
        if (csp) {
            app.use(helmet.contentSecurityPolicy(csp));
        }
    };
    HttpExtension.prototype.extractToken = function (req, res, next) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            var bearerToken, bearerHeader, bearer, context, err_1, doRefresh_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        req.token = null;
                        bearerHeader = req.headers.authorization;
                        if (typeof bearerHeader !== 'undefined') {
                            bearer = bearerHeader.split(' ');
                            bearerToken = bearer[1];
                        }
                        else if (req.cookies.token) {
                            bearerToken = req.cookies.token;
                        }
                        context = null;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.iamService.resolveExecutionContext(bearerToken, core_contracts_1.TokenType.jwt)];
                    case 2:
                        context = _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        err_1 = _a.sent();
                        debugInfo('context can not be generated - token invalid');
                        res.cookie('token', '');
                        doRefresh_1 = false;
                        if (this.config.routeConfiguration) {
                            Object.keys(this.config.routeConfiguration).forEach(function (routeNeedle) {
                                if (req.url.match(new RegExp('^' + routeNeedle.replace(/\//g, '\\/').replace(/\*/g, '.{0,}') + '$', 'i'))) {
                                    doRefresh_1 = _this.config.routeConfiguration[routeNeedle].refreshOnInvalidToken;
                                }
                            });
                        }
                        if (doRefresh_1) {
                            res.header['Refresh'] = '0;url=' + req.url;
                            res.status(307);
                        }
                        else {
                            res.status(403).json({ error: err_1.message });
                        }
                        return [3 /*break*/, 4];
                    case 4:
                        if (context) {
                            req.context = context;
                        }
                        next();
                        return [2 /*return*/];
                }
            });
        });
    };
    HttpExtension.prototype.start = function () {
        var _this = this;
        return new BluebirdPromise(function (resolve, reject) {
            _this._server = _this._httpServer.listen(_this.config.server.port, _this.config.server.host, function () {
                console.log("Started REST API " + _this.config.server.host + ":" + _this.config.server.port);
                utils_1.executeAsExtensionHookAsync(_this.onStarted, _this)
                    .then(function (result) {
                    resolve(result);
                })
                    .catch(function (error) {
                    reject(error);
                });
            });
        }).then(function () {
            console.log('AJSKDHGLAKSJGDJHASGDJHAGSJK');
        });
    };
    return HttpExtension;
}(http_1.HttpExtension));
exports.HttpExtension = HttpExtension;

//# sourceMappingURL=http_extension.js.map
