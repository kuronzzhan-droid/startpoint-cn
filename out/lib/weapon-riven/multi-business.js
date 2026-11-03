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
exports.handleRivenBusiness = void 0;
const node_crypto_1 = require("node:crypto");
const multi_protocol_1 = require("./multi-protocol");
const multi_store_1 = require("./multi-store");
const multi_snapshot_1 = require("./multi-snapshot");
const business_rpc_1 = require("../../multi/coordinator/business-rpc");
/** No registration in a child; business-rpc already rejects child fallback. */
function handleRivenBusiness(kind, value) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const input = (0, multi_protocol_1.cloneRivenJson)(value);
        (0, multi_protocol_1.rivenIdentityKey)(input.identity);
        const proof = (0, business_rpc_1.getRealtimeBusinessAdmission)();
        if ((proof === null || proof === void 0 ? void 0 : proof.ownerEpoch) && proof.ownerEpoch !== input.identity.ownerEpoch)
            throw new Error("RIVEN_OWNER_EPOCH_MISMATCH");
        switch (kind) {
            case "riven.freeze": {
                (0, multi_snapshot_1.validateRivenRequest)(input);
                const fingerprint = (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([input.category, input.questId,
                    input.members.map(member => {
                        var _a, _b, _c;
                        return [member.viewerId, member.playerId, member.connectionId, member.partyId, (_a = member.mate.comId) !== null && _a !== void 0 ? _a : 0, (_b = member.session) !== null && _b !== void 0 ? _b : null, (_c = member.admissionToken) !== null && _c !== void 0 ? _c : null];
                    }), (_a = input.disabledReason) !== null && _a !== void 0 ? _a : ""])).digest("hex");
                return multi_store_1.rivenSnapshotStore.prepare(input.identity, fingerprint, () => (0, multi_snapshot_1.buildRivenSnapshot)(input), snapshot => (0, multi_snapshot_1.validateRivenSnapshotAdmission)(input, snapshot));
            }
            case "riven.validate":
                multi_store_1.rivenSnapshotStore.validate(input);
                return { ok: true };
            case "riven.commit": return multi_store_1.rivenSnapshotStore.commit(input);
            case "riven.cancel": return multi_store_1.rivenSnapshotStore.cancel(input);
            case "riven.release": return multi_store_1.rivenSnapshotStore.release(input);
            case "riven.get": return multi_store_1.rivenSnapshotStore.get(input);
            default: throw new Error("UNKNOWN_RIVEN_BUSINESS_KIND");
        }
    });
}
exports.handleRivenBusiness = handleRivenBusiness;
