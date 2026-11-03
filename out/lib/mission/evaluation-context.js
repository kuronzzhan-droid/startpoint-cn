"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissionEvaluationReadContext = void 0;
const mission_battle_facts_1 = require("../../data/domains/mission_battle_facts");
const character_1 = require("../../data/domains/character");
const item_1 = require("../../data/domains/item");
const player_1 = require("../../data/domains/player");
const quest_1 = require("../../data/domains/quest");
const counters_1 = require("./counters");
const snapshot_1 = require("./snapshot");
/**
 * Request-scoped authoritative reads shared by all mission category computers.
 * The cache deliberately lives for one settlement only; it must never be kept
 * across a reward boundary or reused by another request.
 */
class MissionEvaluationReadContext {
    constructor(playerId) {
        this.playerId = playerId;
        this.snapshots = new Map();
        this.missionCounterValues = new Map();
    }
    get characterFacts() {
        var _a;
        return (_a = this.characterFactsValue) !== null && _a !== void 0 ? _a : (this.characterFactsValue = (0, character_1.getPlayerCharacterMissionFactsSync)(this.playerId));
    }
    get player() {
        if (this.playerValue === undefined)
            this.playerValue = (0, player_1.getPlayerSync)(this.playerId);
        if (!this.playerValue) {
            throw new Error(`Player ${this.playerId} not found during mission settlement.`);
        }
        return this.playerValue;
    }
    get battleCounters() {
        if (this.battleCountersValue === undefined) {
            this.battleCountersValue = (0, mission_battle_facts_1.getMissionBattleCountersSync)(this.playerId);
        }
        return this.battleCountersValue;
    }
    get totalQuestClears() {
        if (this.totalQuestClearsValue === undefined) {
            this.totalQuestClearsValue = (0, quest_1.countFinishedPlayerQuestsSync)(this.playerId);
        }
        return this.totalQuestClearsValue;
    }
    get collectedItemTotals() {
        if (this.collectedItemTotalsValue === undefined) {
            this.collectedItemTotalsValue = (0, item_1.getPlayerCollectedItemTotalsSync)(this.playerId);
        }
        return this.collectedItemTotalsValue;
    }
    get questProgress() {
        if (this.questProgressValue === undefined) {
            this.questProgressValue = (0, quest_1.getPlayerQuestProgressSync)(this.playerId);
        }
        return this.questProgressValue;
    }
    snapshot(periodType) {
        var _a;
        if (!this.snapshots.has(periodType)) {
            this.snapshots.set(periodType, (0, snapshot_1.getSnapshot)(this.playerId, periodType));
        }
        return (_a = this.snapshots.get(periodType)) !== null && _a !== void 0 ? _a : null;
    }
    setSnapshot(periodType, snapshot) {
        this.snapshots.set(periodType, snapshot);
    }
    missionCounters(queries) {
        var _a;
        const missing = queries.filter(query => !this.missionCounterValues.has((0, counters_1.makeMissionCounterKey)(query)));
        if (missing.length > 0) {
            const loaded = (0, counters_1.getMissionCounterValuesSync)(this.playerId, missing);
            for (const query of missing) {
                const key = (0, counters_1.makeMissionCounterKey)(query);
                this.missionCounterValues.set(key, (_a = loaded.get(key)) !== null && _a !== void 0 ? _a : 0);
            }
        }
        return this.missionCounterValues;
    }
}
exports.MissionEvaluationReadContext = MissionEvaluationReadContext;
