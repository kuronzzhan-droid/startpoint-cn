const assert = require("node:assert/strict");
const Fastify = require("fastify");

const versionCheckPlugin = require("../out/routes/cn/versionCheck.js").default;

const MG_LOG_PATHS = [
    "/api/mg_log!addMgActivateLog.action",
    "/api/mg_log!addMgCreateRoleLog.action",
    "/api/mg_log!addMgLoginLog.action",
    "/api/mg_log!addMgRegisterLog.action",
];

async function main() {
    const app = Fastify({ logger: false });
    await app.register(versionCheckPlugin);

    for (const url of MG_LOG_PATHS) {
        const response = await app.inject({ method: "POST", url, payload: { test: true } });
        assert.equal(response.statusCode, 200, `${url} should not trigger H404`);
        assert.deepEqual(response.json(), { code: 0, message: "success" });
    }

    const config = await app.inject({
        method: "GET",
        url: "/wf/210009_config_20200415.json?ts=compat",
    });
    assert.equal(config.statusCode, 200);
    assert.equal(config.json().default.apiPath, "shijtswygamegf.leiting.com");

    const iosVersion = await app.inject({
        method: "GET",
        url: "/shijtswy/version/client_release_ios.dis",
    });
    assert.equal(iosVersion.statusCode, 200);
    assert.match(iosVersion.body, /shijtswygamegf\.leiting\.com/);

    await app.close();
    console.log("iOS compatibility route tests passed");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
