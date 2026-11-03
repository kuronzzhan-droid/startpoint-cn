"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestRoutePath = void 0;
/** Judge authorization by the route selected by Fastify, never the raw URL. */
function requestRoutePath(request) {
    var _a;
    const route = (_a = request.routeOptions) === null || _a === void 0 ? void 0 : _a.url;
    return typeof route === "string" && route.startsWith("/") ? route : "";
}
exports.requestRoutePath = requestRoutePath;
