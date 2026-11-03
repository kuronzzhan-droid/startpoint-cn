"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectPartyCharacterIds = exports.summarizeBattleStatistics = void 0;
function parseNonNegativeStat(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
function parseOptionalNonNegativeStat(value) {
    if (value === undefined || value === null)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
function parsePositiveId(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function firstPresentStat(records, names) {
    for (const record of records) {
        for (const name of names) {
            if ((record === null || record === void 0 ? void 0 : record[name]) === undefined || (record === null || record === void 0 ? void 0 : record[name]) === null)
                continue;
            return parseNonNegativeStat(record[name]);
        }
    }
    return undefined;
}
function sumZoneStat(zones, names) {
    return zones.reduce((total, zone) => {
        var _a;
        return (total + ((_a = firstPresentStat([zone], names)) !== null && _a !== void 0 ? _a : 0));
    }, 0);
}
function rootOrZoneStat(raw, zones, names) {
    var _a;
    return (_a = firstPresentStat([raw], names)) !== null && _a !== void 0 ? _a : sumZoneStat(zones, names);
}
function rootOrMaxZoneStat(raw, zones, names) {
    const root = firstPresentStat([raw], names);
    if (root !== undefined)
        return root;
    return Math.max(0, ...zones.map(zone => { var _a; return (_a = firstPresentStat([zone], names)) !== null && _a !== void 0 ? _a : 0; }));
}
function summarizeBattleStatistics(raw) {
    const zones = Array.isArray(raw === null || raw === void 0 ? void 0 : raw.zones) ? raw.zones : [];
    return {
        dashCount: rootOrZoneStat(raw, zones, ["use_dash_count"]),
        powerFlipCount: rootOrZoneStat(raw, zones, ["use_power_flip_count"]),
        powerFlipLv3Count: rootOrZoneStat(raw, zones, ["use_power_flip_lv3_count"]),
        skillCount: rootOrZoneStat(raw, zones, ["use_skill_count", "skill_count"]),
        maxComboCount: parseNonNegativeStat(raw === null || raw === void 0 ? void 0 : raw.max_combo_count),
        maxSkillChainCount: rootOrZoneStat(raw, zones, ["max_skill_chain_count"]),
        feverCount: rootOrZoneStat(raw, zones, ["fever_count"]),
        feverTimeMs: rootOrZoneStat(raw, zones, ["fever_ms"]),
        weakenEnemyCount: rootOrZoneStat(raw, zones, ["use_debuff_to_enemy_count"]),
        clearEnemyBuffCount: rootOrZoneStat(raw, zones, ["clear_buff_of_enemy_count"]),
        clearSelfDebuffCount: rootOrZoneStat(raw, zones, ["clear_debuff_of_self_count"]),
        buffCompanionCount: rootOrZoneStat(raw, zones, ["use_buff_to_all_party_members"]),
        healCompanionCount: rootOrZoneStat(raw, zones, ["use_heal_to_all_party_members"]),
        emotionCount: rootOrZoneStat(raw, zones, ["use_emotion_count", "send_emotion_count"]),
        enemyKillCount: rootOrZoneStat(raw, zones, ["enemy_kill_count"]),
        weakPointDestroyCount: rootOrZoneStat(raw, zones, ["weak_point_attack_count"]),
        coffinReduceCount: rootOrZoneStat(raw, zones, ["coffin_count_reduced_count"]),
        damageDealMax: rootOrMaxZoneStat(raw, zones, ["damage_deal_max"]),
        revivalCoffinMax: rootOrMaxZoneStat(raw, zones, ["max_coffin_count_by_revival"]),
        clearPhase: parseOptionalNonNegativeStat(raw === null || raw === void 0 ? void 0 : raw.clear_phase),
    };
}
exports.summarizeBattleStatistics = summarizeBattleStatistics;
function collectPartyCharacterIds(party) {
    var _a;
    const characters = Array.isArray(party === null || party === void 0 ? void 0 : party.characters) ? party.characters : [];
    const unisons = Array.isArray(party === null || party === void 0 ? void 0 : party.unison_characters) ? party.unison_characters : [];
    const partyCharacterIds = characters.map((c) => parsePositiveId(c === null || c === void 0 ? void 0 : c.id)).filter((id) => id !== undefined);
    const unisonCharacterIds = unisons.map((c) => parsePositiveId(c === null || c === void 0 ? void 0 : c.id)).filter((id) => id !== undefined);
    const leaderCharacterId = parsePositiveId((_a = characters[0]) === null || _a === void 0 ? void 0 : _a.id);
    return { partyCharacterIds, leaderCharacterId, unisonCharacterIds };
}
exports.collectPartyCharacterIds = collectPartyCharacterIds;
