"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nativeBattleParty = exports.ownedTeam = exports.resolvePublicTeam = exports.loadTeamCodeAssets = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const content_master_1 = require("./content-master");
const wiki_team_code_client_1 = require("./wiki-team-code-client");
let cachedAssets;
function readObject(name) {
    const value = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, "..", "..", "assets", name), "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid team code asset: ${name}`);
    }
    return value;
}
function loadTeamCodeAssets() {
    if (cachedAssets)
        return cachedAssets;
    const characters = content_master_1.serverCharacters;
    const maxLevels = readObject("equipment_max_level.json");
    const dissolve = readObject("equipment_dissolve.json");
    const map = (kind, entries) => new Map(Object.keys(entries)
        .filter(id => /^[1-9]\d*$/.test(id))
        .map(id => [(0, wiki_team_code_client_1.wikiPublicId)(kind, id), Number(id)]));
    const souls = new Map();
    for (const [id, raw] of Object.entries(dissolve)) {
        if (raw === null || typeof raw !== "object" || Array.isArray(raw))
            continue;
        const item = raw;
        if (item.generate_ability_soul === true
            && Number.isSafeInteger(item.ability_soul_id)
            && Number(item.ability_soul_id) > 0) {
            souls.set(Number(id), Number(item.ability_soul_id));
        }
    }
    cachedAssets = {
        characters: map("c", characters),
        equipment: map("w", maxLevels),
        souls,
        maxLevels: Object.fromEntries(Object.entries(maxLevels)
            .filter(([id, value]) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(value))
            .map(([id, value]) => [id, Number(value)])),
    };
    return cachedAssets;
}
exports.loadTeamCodeAssets = loadTeamCodeAssets;
function resolvePublicTeam(team, assets) {
    const native = {};
    for (const group of wiki_team_code_client_1.TEAM_GROUPS) {
        native[group] = team[group].map((id) => {
            if (!id)
                return null;
            const source = group === "main" || group === "unison"
                ? assets.characters
                : assets.equipment;
            const value = source.get(id);
            if (value === undefined)
                return null;
            if (group !== "soul")
                return value;
            const soul = assets.souls.get(value);
            return soul === undefined ? null : soul;
        });
    }
    if (native.main[0] === null)
        throw new wiki_team_code_client_1.TeamCodeError("incompatible");
    return native;
}
exports.resolvePublicTeam = resolvePublicTeam;
/** Projects a code onto current inventory without consuming or mutating it. */
function ownedTeam(team, inventory, assets) {
    const result = {};
    const seenCharacters = new Set();
    const equipmentUse = new Map();
    const soulUse = new Map();
    const characters = new Set(assets.characters.values());
    const equipment = new Set(assets.equipment.values());
    const souls = new Set(assets.souls.values());
    for (const group of wiki_team_code_client_1.TEAM_GROUPS) {
        result[group] = Array.from({ length: 3 }, (_, index) => {
            var _a;
            const id = (_a = team[group]) === null || _a === void 0 ? void 0 : _a[index];
            if (!Number.isSafeInteger(id) || !id || id < 0)
                return null;
            if (group === "main" || group === "unison") {
                if (!characters.has(id) || !inventory.characters[id] || seenCharacters.has(id))
                    return null;
                seenCharacters.add(id);
                return id;
            }
            if (group === "weapon") {
                const owned = inventory.equipment[id];
                const count = (equipmentUse.get(id) || 0) + 1;
                if (!equipment.has(id)
                    || !owned
                    || !Number.isSafeInteger(owned.stack)
                    || owned.stack < 0
                    || count > owned.stack + 1)
                    return null;
                equipmentUse.set(id, count);
                return id;
            }
            const count = (soulUse.get(id) || 0) + 1;
            if (!souls.has(id)
                || !Number.isSafeInteger(inventory.items[id])
                || count > inventory.items[id])
                return null;
            soulUse.set(id, count);
            return id;
        });
    }
    return result;
}
exports.ownedTeam = ownedTeam;
function nativeBattleParty(team, inventory, assets) {
    const own = ownedTeam(team, inventory, assets);
    // A native battle party without a projected leader cannot be consumed by
    // the client. Reject it before reading any other character data.
    if (own.main[0] === null)
        throw new wiki_team_code_client_1.TeamCodeError("incompatible");
    const character = (id) => {
        if (id === null)
            return null;
        const data = inventory.characters[id];
        return {
            id,
            evolution_level: data.evolutionLevel,
            exp: data.exp,
            over_limit_step: data.overLimitStep,
            mana_node_ids: inventory.nodes(id),
            illustration_settings: data.illustrationSettings || null,
            ex_boost: data.exBoost
                ? { status_id: data.exBoost.statusId, ability_id_list: data.exBoost.abilityIdList }
                : null,
        };
    };
    return {
        characters: own.main.map(character),
        unison_characters: own.unison.map(character),
        ability_soul_ids: own.soul,
        equipments: own.weapon.map(id => id === null ? null : {
            equipment_id: id,
            level: Math.min(Math.max(1, inventory.equipment[id].level), assets.maxLevels[id] || 1),
        }),
    };
}
exports.nativeBattleParty = nativeBattleParty;
