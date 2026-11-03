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
// AES-encrypted fixed guest UserBean accepted by the iOS 1.8.4 Leiting SDK.
// The AOT iOS client cannot use the Android sdkDummy path, so these endpoints
// reproduce the native SDK's successful guest-login response.
const IOS_SDK_LOGIN_BLOB = "Ox8piDWnl7p3xCrJ3bwS8RSjUahG/oB4S8D+s39R7Bb/C7XfVkgxohfumfFMK/Or8Kppz+Bk/tZyrEHnERbc0NYeuBKFrcWdQ+gzSuuliP9kIb1uUBP9Uj0DxB49Pnr3MSs6FDp8SZXDvmPjKT8y0twAiSYGQu1GCUwpKT0uJH1zxb8Q6Zyj70UPLlRKPoKnsSRscBIlOj/ACkDy4cBCfAYFFTApjQY4+NnsddSYs40399y59OzTsKMGCuyghJeeBCeATZYeihAkkcj93Prd6YYI7jLYfUPDN4Rxlj5fx9d89ZKQcRE9GTophK7MWQdP6ihEfY49aUHvXXQjRlO3z+gAAhb2VPW8KHnmG/K0jds182SXYhY3EXqf9bPpbO8NqtYKOAx8lRQBO/h01yRP9vBITftZQ0PIee/27v4EsifUiNpGgZO0Z1nduxadLfZuScp+rsPO8LfXK9pc2LPq7Q86AuH80NfA7/zVnCzhvoOLf5G+KpyOtvlHnuVei76T0/clqHs2iBtrPv8vqlBxjeJo0g08dMbaZhYTsOrZv7Q0KSAd3lPrtI6EeB2PqNG1";
const IOS_LOGIN_OK = {
    status: "0",
    type: "0",
    message: "",
    data: IOS_SDK_LOGIN_BLOB,
};
const IOS_STATUS_OK = {
    status: "0",
    statusCode: "0",
    memo: "",
    message: "",
    data: "",
};
const IOS_LOGIN_PATHS = [
    "/mobile!mobileLoginPubV2.action",
    "/login/mobile!mobileLoginPubV2.action",
    "/mobile!sdkLogin.action",
    "/login/mobile!sdkLogin.action",
    "/mobile!guestRegister.action",
    "/login/mobile!guestRegister.action",
    "/mobile!sdkCheckLogin.action",
    "/login/mobile!sdkCheckLogin.action",
    "/sdk/v3-3/code_login_v2.do",
    "/sdk/v3-3/code_login.do",
    "/sdk/v3-3/pwd_login.do",
    "/sdk/v3-3/check_login.do",
    "/sdk/v3-3/check_force.do",
    "/sdk/v3-3/taptap_login.do",
    "/sdk/auth_login.do",
    "/sdk/v3-3/auth_login.do",
];
const IOS_STUB_PATHS = [
    "/mobile_two!getRegisterCodeOnly.action",
    "/login/mobile_two!getRegisterCodeOnly.action",
    "/aes/message/send_phone_code",
    "/aes/message/send_login_verify_code",
    "/aes/message/send_bind_phone_login_code",
    "/aes/message/send_register_code",
];
const SDK_LOG_PATHS = [
    "/api/sdk_log!addScreenLog",
    "/api/sdk_log!addScreenLog.action",
    "/api/sdk_api!getCaidNew",
    "/api/sdk_api!getCaidNew.action",
];
const MG_LOG_PATHS = [
    "/api/mg_log!addMgActivateLog.action",
    "/api/mg_log!addMgCreateRoleLog.action",
    "/api/mg_log!addMgLoginLog.action",
    "/api/mg_log!addMgRegisterLog.action",
];
function iosLeitingRoutes(fastify, options) {
    return __awaiter(this, void 0, void 0, function* () {
        fastify.get("/area/config.json", (_request, reply) => __awaiter(this, void 0, void 0, function* () {
            return reply.type("application/json").send({
                area_list: [],
                cdn_list: [{ url: "" }],
            });
        }));
        fastify.get("/protocols/leiting/switch/switch.txt", (_request, reply) => __awaiter(this, void 0, void 0, function* () {
            return reply.type("text/plain").send("{}");
        }));
        fastify.get("/myip", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            return reply.type("text/plain").send(request.ip);
        }));
        fastify.post("/logmonitor/api/advert!getNewConfig.action", (_request, reply) => __awaiter(this, void 0, void 0, function* () {
            return reply.type("application/json").send({ code: 0, data: {} });
        }));
        fastify.get("/api/skan/query_detail", (_request, reply) => __awaiter(this, void 0, void 0, function* () {
            return reply.type("application/json").send({ code: 0, data: {} });
        }));
        for (const route of SDK_LOG_PATHS) {
            fastify.post(route, (_request, reply) => __awaiter(this, void 0, void 0, function* () {
                return reply.type("application/json").send({ code: 0, data: {} });
            }));
        }
        for (const route of MG_LOG_PATHS) {
            fastify.all(route, (_request, reply) => __awaiter(this, void 0, void 0, function* () {
                return reply.type("application/json").send({ code: 0, message: "success" });
            }));
        }
        fastify.get("/wf/210009_config_20200415.json", (_request, reply) => __awaiter(this, void 0, void 0, function* () {
            return reply.type("application/json").send({
                default: {
                    apiPath: options.ios.apiHost,
                    apiScheme: options.ios.apiScheme,
                },
            });
        }));
        fastify.post("/sync_data", (_request, reply) => __awaiter(this, void 0, void 0, function* () {
            return reply.type("application/json").send({ code: 0 });
        }));
        for (const route of IOS_LOGIN_PATHS) {
            fastify.all(route, (_request, reply) => __awaiter(this, void 0, void 0, function* () { return reply.send(IOS_LOGIN_OK); }));
        }
        for (const route of IOS_STUB_PATHS) {
            fastify.all(route, (_request, reply) => __awaiter(this, void 0, void 0, function* () { return reply.send(IOS_STATUS_OK); }));
        }
    });
}
exports.default = iosLeitingRoutes;
