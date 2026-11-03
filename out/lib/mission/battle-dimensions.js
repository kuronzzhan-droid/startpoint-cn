"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordBattleMissionDimensionsSafe = exports.recordBattleMissionDimensions = void 0;
const character_degree_rewards_1 = require("../character-degree-rewards");
const equipment_degree_rewards_1 = require("../equipment-degree-rewards");
const race_utils_1 = require("../quest/finish/race-utils");
const counters_1 = require("./counters");
const persistence_coordinator_1 = require("../persistence-coordinator");
function add(playerId, query, amount = 1) {
    (0, counters_1.addMissionCounterSync)(playerId, query, amount);
}
function addBattleStat(event, kind, amount) {
    if (amount <= 0)
        return;
    add(event.playerId, {
        dimension: "battle.stat",
        scopeType: "lifetime",
        scopeKey: "all",
        qualifier: { kind, mode: "any" },
    }, amount);
    add(event.playerId, {
        dimension: "battle.stat",
        scopeType: "lifetime",
        scopeKey: "all",
        qualifier: { kind, mode: event.mode },
    }, amount);
}
function recordCharacterCounters(event) {
    const allCharacters = [...new Set([...event.partyCharacterIds, ...event.unisonCharacterIds])];
    for (const characterId of allCharacters) {
        add(event.playerId, {
            dimension: "character.battle_clear",
            scopeType: "character",
            scopeKey: String(characterId),
            qualifier: { position: "any" },
        });
    }
    if (event.leaderCharacterId) {
        add(event.playerId, {
            dimension: "character.battle_clear",
            scopeType: "character",
            scopeKey: String(event.leaderCharacterId),
            qualifier: { position: "leader" },
        });
    }
    const sortedCharacters = [...allCharacters].sort((a, b) => a - b);
    for (let i = 0; i < sortedCharacters.length - 1; i++) {
        for (let j = i + 1; j < sortedCharacters.length; j++) {
            add(event.playerId, {
                dimension: "character.co_clear",
                scopeType: "lifetime",
                scopeKey: "all",
                qualifier: { characters: `${sortedCharacters[i]},${sortedCharacters[j]}` },
            });
        }
    }
    const races = sortedCharacters.flatMap(characterId => (0, race_utils_1.getCharacterRaces)(characterId));
    const raceKey = (0, race_utils_1.getRaceKeyString)(races);
    if (raceKey) {
        add(event.playerId, {
            dimension: "character.race_clear",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: { raceKey },
        });
    }
}
function recordBattleMissionDimensionWrites(event) {
    var _a;
    add(event.playerId, {
        dimension: "battle.clear",
        scopeType: "lifetime",
        scopeKey: "all",
        qualifier: { mode: "any" },
    });
    if (event.clearTimeMs > 0) {
        for (const mode of ["any", event.mode]) {
            (0, counters_1.setMissionCounterMinSync)(event.playerId, {
                dimension: "battle.best_clear_time_ms",
                scopeType: "lifetime",
                scopeKey: "all",
                qualifier: { mode },
            }, event.clearTimeMs);
        }
    }
    if (((_a = event.score) !== null && _a !== void 0 ? _a : 0) > 0) {
        for (const mode of ["any", event.mode]) {
            (0, counters_1.setMissionCounterMaxSync)(event.playerId, {
                dimension: "battle.max_score",
                scopeType: "lifetime",
                scopeKey: "all",
                qualifier: { mode },
            }, event.score);
        }
    }
    add(event.playerId, {
        dimension: "battle.clear",
        scopeType: "lifetime",
        scopeKey: "all",
        qualifier: { mode: event.mode },
    });
    add(event.playerId, {
        dimension: "battle.quest_clear",
        scopeType: "lifetime",
        scopeKey: "all",
        qualifier: { questCategory: event.questCategory, questId: event.questId, mode: "any" },
    });
    add(event.playerId, {
        dimension: "battle.quest_clear",
        scopeType: "lifetime",
        scopeKey: "all",
        qualifier: { questCategory: event.questCategory, questId: event.questId, mode: event.mode },
    });
    if (event.clearRank !== null && event.clearRank !== undefined) {
        for (const mode of ["any", event.mode]) {
            add(event.playerId, {
                dimension: "battle.rank_clear",
                scopeType: "lifetime",
                scopeKey: "all",
                qualifier: { rank: event.clearRank, mode },
            });
            add(event.playerId, {
                dimension: "battle.quest_rank_clear",
                scopeType: "lifetime",
                scopeKey: "all",
                qualifier: {
                    questCategory: event.questCategory,
                    questId: event.questId,
                    rank: event.clearRank,
                    mode,
                },
            });
        }
    }
    if (event.statistics.clearPhase !== undefined) {
        add(event.playerId, {
            dimension: "battle.phase_clear",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: { phase: event.statistics.clearPhase },
        });
    }
    if (event.statistics.dashCount > 0) {
        addBattleStat(event, "dash", event.statistics.dashCount);
    }
    if (event.statistics.powerFlipCount > 0) {
        addBattleStat(event, "power_flip", event.statistics.powerFlipCount);
    }
    if (event.statistics.skillCount > 0) {
        addBattleStat(event, "skill", event.statistics.skillCount);
    }
    addBattleStat(event, "power_flip_lv3", event.statistics.powerFlipLv3Count);
    addBattleStat(event, "fever", event.statistics.feverCount);
    addBattleStat(event, "fever_time_ms", event.statistics.feverTimeMs);
    addBattleStat(event, "debuff_enemy", event.statistics.weakenEnemyCount);
    addBattleStat(event, "clear_buff_enemy", event.statistics.clearEnemyBuffCount);
    addBattleStat(event, "clear_debuff_self", event.statistics.clearSelfDebuffCount);
    addBattleStat(event, "buff_companion", event.statistics.buffCompanionCount);
    addBattleStat(event, "heal_companion", event.statistics.healCompanionCount);
    addBattleStat(event, "emotion", event.statistics.emotionCount);
    addBattleStat(event, "enemy_kill", event.statistics.enemyKillCount);
    addBattleStat(event, "weak_point", event.statistics.weakPointDestroyCount);
    addBattleStat(event, "coffin_reduce", event.statistics.coffinReduceCount);
    if (event.statistics.maxComboCount > 0) {
        (0, counters_1.setMissionCounterMaxSync)(event.playerId, {
            dimension: "battle.max_combo",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: {},
        }, event.statistics.maxComboCount);
    }
    if (event.statistics.maxSkillChainCount > 0) {
        (0, counters_1.setMissionCounterMaxSync)(event.playerId, {
            dimension: "battle.max_skill_chain",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: {},
        }, event.statistics.maxSkillChainCount);
    }
    if (event.statistics.damageDealMax > 0) {
        (0, counters_1.setMissionCounterMaxSync)(event.playerId, {
            dimension: "battle.max_damage",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: {},
        }, event.statistics.damageDealMax);
    }
    if (event.statistics.revivalCoffinMax > 0) {
        (0, counters_1.setMissionCounterMaxSync)(event.playerId, {
            dimension: "battle.max_revival_coffin",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: {},
        }, event.statistics.revivalCoffinMax);
    }
    if (event.mode === "multi" && event.role) {
        add(event.playerId, {
            dimension: "battle.multi_role_clear",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: { role: event.role },
        });
    }
    if (event.mode === "multi" && event.isRescue) {
        add(event.playerId, {
            dimension: "battle.multi_rescue_clear",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: {},
        });
        if (event.questCategory === 2) {
            const questRank = Math.abs(Math.trunc(event.questId)) % 10;
            if (questRank >= 1 && questRank <= 5) {
                add(event.playerId, {
                    dimension: "battle.multi_rescue_clear",
                    scopeType: "lifetime",
                    scopeKey: "all",
                    qualifier: { questRank },
                });
            }
        }
    }
    if (event.mode === "multi" && event.isNewbieRescue) {
        add(event.playerId, {
            dimension: "battle.multi_newbie_rescue_clear",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: {},
        });
    }
    if (event.mode === "multi" && event.isMvp) {
        add(event.playerId, {
            dimension: "battle.multi_mvp",
            scopeType: "lifetime",
            scopeKey: "all",
            qualifier: {},
        });
    }
    recordCharacterCounters(event);
}
function recordBattleMissionDimensions(event) {
    if (!event.accomplished)
        return;
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "mission", playerId: event.playerId, operation: "record_battle_mission_dimensions",
    }, () => {
        recordBattleMissionDimensionWrites(event);
        (0, character_degree_rewards_1.grantPracticeCharacterDegreeRewardsSync)(event);
        (0, equipment_degree_rewards_1.grantPracticeExclusiveDegreeRewardsSync)(event);
    });
}
exports.recordBattleMissionDimensions = recordBattleMissionDimensions;
function recordBattleMissionDimensionsSafe(event) {
    try {
        recordBattleMissionDimensions(event);
    }
    catch (error) {
        console.warn("[MISSION] battle dimension counter write failed", error);
    }
}
exports.recordBattleMissionDimensionsSafe = recordBattleMissionDimensionsSafe;
