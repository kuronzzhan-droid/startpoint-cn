"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimRaidEventOverallRewardsSync = exports.recordRaidEventClearSync = exports.getRaidEventQuestKillCountSync = exports.getRaidEventQuestKillCountsSync = exports.getRaidEventGlobalKillCountSync = exports.getRaidEventGlobalBossSync = void 0;
const db_1 = require("../data/db");
const raid_event_counts_1 = require("./raid-event-counts");
const persistence_coordinator_1 = require("./persistence-coordinator");
const cached_statement_1 = require("./cached-statement");
const quest_1 = require("./quest");
const types_1 = require("./types");
const raid_event_config_1 = require("./raid-event-config");
// event/raid/summary uses the remote reward-kind numbering consumed by
// RaidEventLogic.rewardListToGeneralRewardKinds, not the 0-based kind values
// stored in raid_event_overall_reward.orderedmap.
var RaidEventResponseRewardKind;
(function (RaidEventResponseRewardKind) {
    RaidEventResponseRewardKind[RaidEventResponseRewardKind["ITEM"] = 1] = "ITEM";
    RaidEventResponseRewardKind[RaidEventResponseRewardKind["FREE_STONE"] = 3] = "FREE_STONE";
    RaidEventResponseRewardKind[RaidEventResponseRewardKind["CHARACTER"] = 5] = "CHARACTER";
    RaidEventResponseRewardKind[RaidEventResponseRewardKind["EQUIPMENT"] = 6] = "EQUIPMENT";
    RaidEventResponseRewardKind[RaidEventResponseRewardKind["MANA"] = 8] = "MANA";
    RaidEventResponseRewardKind[RaidEventResponseRewardKind["POOLED_EXP"] = 9] = "POOLED_EXP";
})(RaidEventResponseRewardKind || (RaidEventResponseRewardKind = {}));
// Raid event 7 (Battle Banquet) total-kill rewards. The 300-kill special
// reward is customized to Abyss ten-pull tickets x25 (250 pulls).
const BATTLE_BANQUET_TOTAL_REWARDS = [
    {
        threshold: 50,
        rewards: [
            { kind: RaidEventResponseRewardKind.ITEM, kind_id: 49100, number: 10 },
            { kind: RaidEventResponseRewardKind.ITEM, kind_id: 10003, number: 1 },
        ],
    },
    {
        threshold: 100,
        rewards: [
            { kind: RaidEventResponseRewardKind.ITEM, kind_id: 49100, number: 10 },
            { kind: RaidEventResponseRewardKind.ITEM, kind_id: 14040, number: 1 },
        ],
    },
    {
        threshold: 150,
        rewards: [
            { kind: RaidEventResponseRewardKind.ITEM, kind_id: 49100, number: 15 },
            { kind: RaidEventResponseRewardKind.ITEM, kind_id: 14040, number: 1 },
        ],
    },
    {
        threshold: 200,
        rewards: [
            { kind: RaidEventResponseRewardKind.FREE_STONE, kind_id: null, number: 600 },
            { kind: RaidEventResponseRewardKind.ITEM, kind_id: 14040, number: 1 },
        ],
    },
    {
        threshold: 250,
        rewards: [
            { kind: RaidEventResponseRewardKind.ITEM, kind_id: 49100, number: 20 },
            { kind: RaidEventResponseRewardKind.ITEM, kind_id: 12002, number: 1 },
        ],
    },
    {
        threshold: 300,
        rewards: [
            { kind: RaidEventResponseRewardKind.FREE_STONE, kind_id: null, number: 2000 },
            { kind: RaidEventResponseRewardKind.ITEM, kind_id: 999014, number: 25 },
        ],
    },
];
function getBattleBanquetRewardsBetween(previousCount, currentCount) {
    const rewards = [];
    const newKillCount = Math.max(0, currentCount - previousCount);
    // Official repeat reward: every kill grants Mana x500 and item 100000 x25.
    if (newKillCount > 0) {
        rewards.push({ kind: RaidEventResponseRewardKind.MANA, kind_id: null, number: 500 * newKillCount }, { kind: RaidEventResponseRewardKind.ITEM, kind_id: 100000, number: 25 * newKillCount });
    }
    for (const reward of BATTLE_BANQUET_TOTAL_REWARDS) {
        if (reward.threshold > previousCount && reward.threshold <= currentCount) {
            rewards.push(...reward.rewards);
        }
    }
    // Official repeat reward after 300: Star Stones x300 at 400, 500, 600, ...
    let repeatedStoneRewards = 0;
    for (let threshold = 400; threshold <= currentCount; threshold += 100) {
        if (threshold > previousCount)
            repeatedStoneRewards++;
    }
    if (repeatedStoneRewards > 0) {
        rewards.push({
            kind: RaidEventResponseRewardKind.FREE_STONE,
            kind_id: null,
            number: 300 * repeatedStoneRewards,
        });
    }
    return rewards;
}
function aggregateRewards(rewards) {
    var _a;
    const aggregated = new Map();
    for (const reward of rewards) {
        const key = `${reward.kind}:${(_a = reward.kind_id) !== null && _a !== void 0 ? _a : ""}`;
        const existing = aggregated.get(key);
        if (existing) {
            existing.number += reward.number;
        }
        else {
            aggregated.set(key, Object.assign({}, reward));
        }
    }
    return [...aggregated.values()];
}
function applyRewardEntriesSync(playerId, entries) {
    const ordinaryRewards = [];
    for (const entry of entries) {
        switch (entry.kind) {
            case RaidEventResponseRewardKind.ITEM:
                if (entry.kind_id !== null) {
                    ordinaryRewards.push({
                        type: types_1.RewardType.ITEM,
                        id: entry.kind_id,
                        count: entry.number,
                    });
                }
                break;
            case RaidEventResponseRewardKind.EQUIPMENT:
                if (entry.kind_id !== null) {
                    ordinaryRewards.push({
                        type: types_1.RewardType.EQUIPMENT,
                        id: entry.kind_id,
                        count: entry.number,
                    });
                }
                break;
            case RaidEventResponseRewardKind.FREE_STONE:
                ordinaryRewards.push({
                    type: types_1.RewardType.BEADS,
                    count: entry.number,
                });
                break;
            case RaidEventResponseRewardKind.MANA:
                ordinaryRewards.push({
                    type: types_1.RewardType.MANA,
                    count: entry.number,
                });
                break;
            case RaidEventResponseRewardKind.POOLED_EXP:
                ordinaryRewards.push({
                    type: types_1.RewardType.EXP,
                    count: entry.number,
                });
                break;
            case RaidEventResponseRewardKind.CHARACTER:
                if (entry.kind_id !== null) {
                    for (let i = 0; i < entry.number; i++) {
                        ordinaryRewards.push({
                            type: types_1.RewardType.CHARACTER,
                            id: entry.kind_id,
                        });
                    }
                }
                break;
        }
    }
    return ordinaryRewards.length > 0
        ? (0, quest_1.givePlayerRewardsSync)(playerId, ordinaryRewards)
        : null;
}
function calculateHpPercentage(weightedKillCount, requiredKillCount) {
    if (requiredKillCount <= 0)
        return 100;
    const ratio = Math.max(0, Math.min(1, weightedKillCount / requiredKillCount));
    return Math.ceil((1 - ratio) * 1000) / 10;
}
function rebuildRaidEventGlobalStateSync(eventId) {
    var _a;
    const rule = (0, raid_event_config_1.getRaidEventProgressRule)(eventId);
    const rows = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT quest_id
        FROM raid_event_global_kill_ledger
        WHERE event_id = ?
        ORDER BY created_at, rowid
    `).all(eventId);
    let weightedKillCount = 0;
    let totalKillCount = 0;
    for (const row of rows) {
        const questWeight = (_a = rule.questWeights[row.quest_id]) !== null && _a !== void 0 ? _a : 0;
        weightedKillCount += questWeight;
        if (weightedKillCount >= rule.requiredKillCount) {
            weightedKillCount = 0;
            totalKillCount++;
        }
    }
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        INSERT INTO raid_event_global_state
            (
                event_id,
                total_kill_count,
                weighted_kill_count,
                calculation_version,
                updated_at
            )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
            total_kill_count = excluded.total_kill_count,
            weighted_kill_count = excluded.weighted_kill_count,
            calculation_version = excluded.calculation_version,
            updated_at = excluded.updated_at
    `).run(eventId, totalKillCount, weightedKillCount, raid_event_config_1.RAID_EVENT_CALCULATION_VERSION, Date.now());
    return {
        hpPercentage: calculateHpPercentage(weightedKillCount, rule.requiredKillCount),
        totalKillCount,
        weightedKillCount,
        requiredKillCount: rule.requiredKillCount,
    };
}
function getRaidEventGlobalBossSync(eventId) {
    const rule = (0, raid_event_config_1.getRaidEventProgressRule)(eventId);
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT total_kill_count, weighted_kill_count, calculation_version
        FROM raid_event_global_state
        WHERE event_id = ?
    `).get(eventId);
    if (row && row.calculation_version >= raid_event_config_1.RAID_EVENT_CALCULATION_VERSION) {
        return {
            hpPercentage: calculateHpPercentage(row.weighted_kill_count, rule.requiredKillCount),
            totalKillCount: row.total_kill_count,
            weightedKillCount: row.weighted_kill_count,
            requiredKillCount: rule.requiredKillCount,
        };
    }
    const hasLedger = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT 1
        FROM raid_event_global_kill_ledger
        WHERE event_id = ?
        LIMIT 1
    `).get(eventId);
    if (row || hasLedger)
        return rebuildRaidEventGlobalStateSync(eventId);
    return {
        hpPercentage: 100,
        totalKillCount: 0,
        weightedKillCount: 0,
        requiredKillCount: rule.requiredKillCount,
    };
}
exports.getRaidEventGlobalBossSync = getRaidEventGlobalBossSync;
function getRaidEventGlobalKillCountSync(eventId) {
    return getRaidEventGlobalBossSync(eventId).totalKillCount;
}
exports.getRaidEventGlobalKillCountSync = getRaidEventGlobalKillCountSync;
function getRaidEventQuestKillCountsSync(eventId) {
    return (0, raid_event_counts_1.getRaidQuestCounts)((0, db_1.getDb)(), eventId);
}
exports.getRaidEventQuestKillCountsSync = getRaidEventQuestKillCountsSync;
function getRaidEventQuestKillCountSync(eventId, questId) {
    return (0, raid_event_counts_1.getRaidQuestCount)((0, db_1.getDb)(), eventId, questId);
}
exports.getRaidEventQuestKillCountSync = getRaidEventQuestKillCountSync;
function recordRaidEventClearSync(params) {
    const { eventId, playId, playerId, questId } = params;
    const supportedEvent = (0, raid_event_config_1.isSupportedRaidEventId)(eventId);
    const questMatchesEvent = supportedEvent && (0, raid_event_config_1.getRaidEventIdForQuest)(questId) === eventId;
    if (!supportedEvent || !questMatchesEvent || !playId) {
        return {
            counted: false,
            questWeight: 0,
            questKillCount: 0,
            boss: {
                hpPercentage: 100,
                totalKillCount: 0,
                weightedKillCount: 0,
                requiredKillCount: supportedEvent
                    ? (0, raid_event_config_1.getRaidEventProgressRule)(eventId).requiredKillCount
                    : 0,
            },
        };
    }
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "event", playerId, operation: "record_raid_event_clear",
    }, () => {
        var _a;
        const currentBoss = getRaidEventGlobalBossSync(eventId);
        const rule = (0, raid_event_config_1.getRaidEventProgressRule)(eventId);
        const questWeight = (_a = rule.questWeights[questId]) !== null && _a !== void 0 ? _a : 0;
        const ledgerInsert = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
            INSERT OR IGNORE INTO raid_event_global_kill_ledger
                (event_id, play_id, player_id, quest_id, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(eventId, playId, playerId, questId, Date.now());
        let boss = currentBoss;
        if (ledgerInsert.changes > 0) {
            let weightedKillCount = currentBoss.weightedKillCount + questWeight;
            let totalKillCount = currentBoss.totalKillCount;
            if (weightedKillCount >= rule.requiredKillCount) {
                weightedKillCount = 0;
                totalKillCount++;
            }
            (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
                INSERT INTO raid_event_global_state
                    (
                        event_id,
                        total_kill_count,
                        weighted_kill_count,
                        calculation_version,
                        updated_at
                    )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(event_id) DO UPDATE SET
                    total_kill_count = excluded.total_kill_count,
                    weighted_kill_count = excluded.weighted_kill_count,
                    calculation_version = excluded.calculation_version,
                    updated_at = excluded.updated_at
            `).run(eventId, totalKillCount, weightedKillCount, raid_event_config_1.RAID_EVENT_CALCULATION_VERSION, Date.now());
            boss = {
                hpPercentage: calculateHpPercentage(weightedKillCount, rule.requiredKillCount),
                totalKillCount,
                weightedKillCount,
                requiredKillCount: rule.requiredKillCount,
            };
        }
        return {
            counted: ledgerInsert.changes > 0,
            questWeight,
            questKillCount: getRaidEventQuestKillCountSync(eventId, questId),
            boss,
        };
    });
}
exports.recordRaidEventClearSync = recordRaidEventClearSync;
function claimRaidEventOverallRewardsSync(playerId, eventId, totalKillCount) {
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "event", playerId, operation: "claim_raid_event_overall_rewards",
    }, () => {
        var _a;
        const receipt = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
            SELECT received_up_to
            FROM players_raid_event_overall_rewards
            WHERE player_id = ? AND event_id = ?
        `).get(playerId, eventId);
        const previousCount = (_a = receipt === null || receipt === void 0 ? void 0 : receipt.received_up_to) !== null && _a !== void 0 ? _a : 0;
        if (eventId !== 7 || totalKillCount <= previousCount) {
            return {
                receivedUpTo: previousCount,
                rewardList: [],
                rewardResult: null,
            };
        }
        const rewardList = aggregateRewards(getBattleBanquetRewardsBetween(previousCount, totalKillCount));
        const rewardResult = applyRewardEntriesSync(playerId, rewardList);
        (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
            INSERT INTO players_raid_event_overall_rewards
                (player_id, event_id, received_up_to, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(player_id, event_id) DO UPDATE SET
                received_up_to = excluded.received_up_to,
                updated_at = excluded.updated_at
        `).run(playerId, eventId, totalKillCount, Date.now());
        return {
            receivedUpTo: totalKillCount,
            rewardList,
            rewardResult,
        };
    });
}
exports.claimRaidEventOverallRewardsSync = claimRaidEventOverallRewardsSync;
