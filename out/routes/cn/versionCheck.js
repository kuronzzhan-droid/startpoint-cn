"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const CN_API_HOST = "shijtswygamegf.leiting.com";
const versionDataAndroid = [
    "// 用于官服正式用",
    JSON.stringify({
        "default": {
            "apiPath": CN_API_HOST,
        },
    })
].join("\r\n");
const routes = (fastify_1, ...args_1) => __awaiter(void 0, [fastify_1, ...args_1], void 0, function* (fastify, options = {}) {
    var _a;
    const versionDataIos = ((_a = options.ios) === null || _a === void 0 ? void 0 : _a.enabled) === true
        ? [
            "// 用于官服正式用",
            JSON.stringify({
                "default": {
                    "apiPath": options.ios.apiHost,
                    "apiScheme": options.ios.apiScheme,
                },
            }),
        ].join("\r\n")
        : versionDataAndroid;
    fastify.get("/shijtswy/version/client_release_android.dis", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        reply.header("content-type", "text/plain; charset=utf-8");
        return reply.status(200).send(versionDataAndroid);
    }));
    fastify.get("/shijtswy/version/client_release_ios.dis", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        reply.header("content-type", "text/plain; charset=utf-8");
        return reply.status(200).send(versionDataIos);
    }));
});
exports.default = routes;
