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
const assets_1 = require("../../lib/assets");
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.get("/ping", () => __awaiter(void 0, void 0, void 0, function* () {
        return ({
            ok: true,
            server_time: new Date().toISOString(),
        });
    }));
    fastify.post("/reload_assets", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            return reply.status(200).send({
                ok: true,
                reloaded: (0, assets_1.reloadRogueEventConfig)(),
            });
        }
        catch (error) {
            fastify.log.error(error);
            return reply.status(500).send({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }));
});
exports.default = routes;
