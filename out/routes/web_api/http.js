"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wantsJson = void 0;
// 迁移期：SPA 客户端带 Accept: application/json，旧 SSR 表单不带。
// 据此分流：JSON 客户端返回 JSON，旧页面保留 302 redirect。
function wantsJson(request) {
    var _a;
    return ((_a = request.headers.accept) !== null && _a !== void 0 ? _a : "").includes("application/json");
}
exports.wantsJson = wantsJson;
