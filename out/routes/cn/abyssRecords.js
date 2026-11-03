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
const abyss_records_1 = require("../../data/domains/abyss-records");
const abyss_time_revision_1 = require("../../lib/abyss-time-revision");
const assets_1 = require("../../lib/assets");
/** Public record and game nickname only; no identifiers or write operation. */
function abyssRecordsRoutes(app) {
    return __awaiter(this, void 0, void 0, function* () {
        app.get("/abyss-records/:questId", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            reply.header("Cache-Control", "no-store");
            const questId = Number(request.params.questId);
            if (!/^700(?:099|100)0\d{2}$/.test(request.params.questId) || !(0, abyss_time_revision_1.isAbyssFiniteQuest)(24, questId)
                || !(0, assets_1.getQuestFromCategorySync)(24, questId))
                return reply.code(404).send({ status: "not_found" });
            const eventId = Math.floor(questId / 1000);
            const revision = (0, abyss_time_revision_1.getAbyssTimeRevision)(eventId);
            if (!revision || (0, abyss_time_revision_1.getAbyssTimeRevisionAtVersion)(request.query.res_ver, eventId) !== revision)
                return { status: "update_required", quest_id: questId, best_time_ms: null };
            const record = (0, abyss_records_1.getAbyssFloorRecordDetailsSync)(revision, questId);
            return { status: "ok", quest_id: questId, revision,
                best_time_ms: (_a = record === null || record === void 0 ? void 0 : record.bestTimeMs) !== null && _a !== void 0 ? _a : null, holder_name: (_b = record === null || record === void 0 ? void 0 : record.holderName) !== null && _b !== void 0 ? _b : null };
        }));
    });
}
exports.default = abyssRecordsRoutes;
