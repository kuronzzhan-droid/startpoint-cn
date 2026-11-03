"use strict";
// ─── Active mission ID filter (C8601 prevention) ────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterToActiveMissions = exports.isActiveMissionId = void 0;
const active_master_data_1 = require("./active-master-data");
const activeMissionIdSet = new Set((0, active_master_data_1.getActiveMissionMasterDefinitions)().map(definition => definition.missionId));
function getActiveMissionIdSet(repository) {
    return repository
        ? new Set((0, active_master_data_1.getActiveMissionMasterDefinitions)(repository).map(definition => definition.missionId))
        : activeMissionIdSet;
}
function isActiveMissionId(id, repository) {
    return getActiveMissionIdSet(repository).has(Number(id));
}
exports.isActiveMissionId = isActiveMissionId;
function filterToActiveMissions(missions, repository) {
    const missionIds = getActiveMissionIdSet(repository);
    const out = {};
    for (const [id, value] of Object.entries(missions)) {
        if (missionIds.has(Number(id)))
            out[id] = value;
    }
    return out;
}
exports.filterToActiveMissions = filterToActiveMissions;
