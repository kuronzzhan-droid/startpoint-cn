"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.abortFiveBossBattle = exports.finishFiveBossBattle = exports.startFiveBossBattle = exports.createFiveBossBattleRuntime = exports.FiveBossBattleRuntimeError = void 0;
const character_1 = require("../../lib/character");
const assets_1 = require("../../lib/assets");
const equipment_1 = require("../../lib/equipment");
const db_1 = require("../../data/db");
const weaponRiven_1 = require("../../data/domains/weaponRiven");
const battle_1 = require("../../lib/weapon-riven/battle");
const loadout_1 = require("../../lib/weapon-riven/loadout");
const item_1 = require("../../data/domains/item");
const quest_1 = require("../../data/domains/quest");
const quest_active_1 = require("../../data/domains/quest_active");
const fiveBossGauntletRun_1 = require("../../data/domains/fiveBossGauntletRun");
const contract_1 = require("./contract");
const rewards_1 = require("./rewards");
class FiveBossBattleRuntimeError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "FiveBossBattleRuntimeError";
    }
}
exports.FiveBossBattleRuntimeError = FiveBossBattleRuntimeError;
function runtimeFail(code, message) {
    throw new FiveBossBattleRuntimeError(code, message);
}
function positiveInteger(name, value) {
    if (!Number.isSafeInteger(value) || value < 1) {
        runtimeFail("invalid_argument", `${name} must be a positive safe integer`);
    }
    return value;
}
function normalizedText(name, value, maxLength = 255) {
    if (typeof value !== "string"
        || value.length < 1
        || value.length > maxLength
        || value.trim() !== value
        || value.includes("\0")) {
        runtimeFail("invalid_argument", `${name} must be normalized non-empty text`);
    }
    return value;
}
function optionalNonNegativeInteger(name, value) {
    if (value === undefined)
        return 0;
    if (!Number.isSafeInteger(value) || value < 0) {
        runtimeFail("invalid_argument", `${name} must be a non-negative safe integer`);
    }
    return value;
}
function optionalPositiveIntegerOrNull(name, value) {
    if (value === undefined || value === null)
        return null;
    return positiveInteger(name, value);
}
function assertSpecialRequest(identity) {
    positiveInteger("playerId", identity.playerId);
    normalizedText("clientPlayId", identity.clientPlayId);
    normalizedText("requestRoomNumber", identity.requestRoomNumber);
    if (!(0, contract_1.isFiveBossGauntletQuest)(identity.requestCategory, identity.requestQuestId)) {
        runtimeFail("request_identity_mismatch", "request is not the exact five-boss route");
    }
}
function assertRunIdentity(run, identity) {
    if (run.routeId !== contract_1.FIVE_BOSS_GAUNTLET.routeId
        || run.roomNumber !== identity.requestRoomNumber
        || run.ticketItemId !== contract_1.FIVE_BOSS_GAUNTLET.ticketItemId) {
        runtimeFail("run_identity_mismatch", "ledger run does not match the five-boss request");
    }
}
function assertPersistentActiveQuest(run, member, identity) {
    assertRunIdentity(run, identity);
    const active = (0, quest_active_1.getPlayerActiveQuestSync)(identity.playerId);
    if (active === null
        || active.playerId !== identity.playerId
        || active.playId !== identity.clientPlayId
        || active.questId !== contract_1.FIVE_BOSS_GAUNTLET.visibleQuestId
        || active.category !== contract_1.FIVE_BOSS_GAUNTLET.category
        || active.roomNumber !== run.roomNumber
        || active.isMulti !== true
        || active.useBoostPoint !== false
        || active.useBossBoostPoint !== false
        || active.isAutoStartMode !== member.isAutoMode) {
        runtimeFail("active_quest_mismatch", "persistent active quest does not match the ledger member");
    }
}
function updateSuccessfulQuestProgress(playerId, input, previous) {
    var _a;
    const elapsedTimeMs = optionalNonNegativeInteger("elapsedTimeMs", input.elapsedTimeMs);
    const highScore = optionalNonNegativeInteger("highScore", input.highScore);
    const leaderCharacterId = optionalPositiveIntegerOrNull("leaderCharacterId", input.leaderCharacterId);
    const bestElapsedTimeMs = (previous === null || previous === void 0 ? void 0 : previous.bestElapsedTimeMs) == null
        ? elapsedTimeMs
        : Math.min(previous.bestElapsedTimeMs, elapsedTimeMs);
    const bestHighScore = (previous === null || previous === void 0 ? void 0 : previous.highScore) == null
        ? highScore
        : Math.max(previous.highScore, highScore);
    const bestClearRank = Math.max((_a = previous === null || previous === void 0 ? void 0 : previous.clearRank) !== null && _a !== void 0 ? _a : 0, 5);
    if (previous === null) {
        (0, quest_1.insertPlayerQuestProgressSync)(playerId, contract_1.FIVE_BOSS_GAUNTLET.category, {
            questId: contract_1.FIVE_BOSS_GAUNTLET.visibleQuestId,
            finished: true,
            bestElapsedTimeMs,
            highScore: bestHighScore,
            clearRank: bestClearRank,
            leaderCharacterId: leaderCharacterId !== null && leaderCharacterId !== void 0 ? leaderCharacterId : undefined,
        });
    }
    else {
        (0, quest_1.updatePlayerQuestProgressSync)(playerId, contract_1.FIVE_BOSS_GAUNTLET.category, {
            questId: contract_1.FIVE_BOSS_GAUNTLET.visibleQuestId,
            finished: true,
            bestElapsedTimeMs,
            highScore: bestHighScore,
            clearRank: bestClearRank,
            leaderCharacterId: leaderCharacterId !== null && leaderCharacterId !== void 0 ? leaderCharacterId : undefined,
        });
    }
    const increment = (0, db_1.getDb)().prepare(`
        UPDATE players_quest_progress
        SET multi_clear_count = multi_clear_count + 1
        WHERE player_id = ? AND section = ? AND quest_id = ?
    `).run(playerId, contract_1.FIVE_BOSS_GAUNTLET.category, contract_1.FIVE_BOSS_GAUNTLET.visibleQuestId);
    if (increment.changes !== 1) {
        runtimeFail("active_quest_mismatch", "quest progress row was not persisted");
    }
}
function validateFrozenStart(input) {
    assertSpecialRequest(input);
    if (input.room.room_number !== input.requestRoomNumber
        || !(0, contract_1.isFiveBossGauntletQuest)(input.room.category, input.room.quest_id)) {
        runtimeFail("request_identity_mismatch", "request and live room identity differ");
    }
    if (input.room.raising_state !== 4) {
        runtimeFail("room_not_in_battle", "five-boss room must be in raising_state 4");
    }
    if (input.useBoostPoint !== false || input.useBossBoostPoint !== false) {
        runtimeFail("boost_not_allowed", "five-boss runs do not accept boost points");
    }
    const frozen = input.room.five_boss_runtime;
    if (!frozen)
        runtimeFail("missing_frozen_runtime", "five-boss room has no frozen runtime");
    const runId = normalizedText("runId", frozen.runId);
    const hostPlayerId = positiveInteger("hostPlayerId", input.room.host_player_id);
    if (!Array.isArray(frozen.expectedRealPlayerIds)
        || frozen.expectedRealPlayerIds.length < 1
        || frozen.expectedRealPlayerIds.length > contract_1.FIVE_BOSS_GAUNTLET.roomMemberLimit) {
        runtimeFail("invalid_frozen_roster", "frozen roster must contain one to three real players");
    }
    const rosterPlayerIds = frozen.expectedRealPlayerIds.map((playerId, index) => (positiveInteger(`expectedRealPlayerIds[${index}]`, playerId)));
    if (new Set(rosterPlayerIds).size !== rosterPlayerIds.length || !rosterPlayerIds.includes(hostPlayerId)) {
        runtimeFail("invalid_frozen_roster", "frozen roster must be unique and contain the host");
    }
    if (!rosterPlayerIds.includes(input.playerId)) {
        runtimeFail("participant_not_frozen", "caller is not in the frozen real-player roster");
    }
    for (const playerId of rosterPlayerIds) {
        if (typeof frozen.autoplayModeByPlayerId[String(playerId)] !== "boolean") {
            runtimeFail("missing_frozen_autoplay", `missing frozen Auto mode for player ${playerId}`);
        }
    }
    return {
        runId,
        rosterPlayerIds,
        isAutoMode: frozen.autoplayModeByPlayerId[String(input.playerId)],
    };
}
function buildActiveQuest(input, isAutoMode) {
    var _a, _b;
    return {
        questId: contract_1.FIVE_BOSS_GAUNTLET.visibleQuestId,
        category: contract_1.FIVE_BOSS_GAUNTLET.category,
        useBoostPoint: false,
        useBossBoostPoint: false,
        isAutoStartMode: isAutoMode,
        isMulti: true,
        isMultiHost: input.playerId === input.room.host_player_id,
        startedAtMs: Date.now(),
        roomNumber: input.requestRoomNumber,
        matePlayerIds: [...((_a = input.matePlayerIds) !== null && _a !== void 0 ? _a : [])],
        mateComIds: [...((_b = input.mateComIds) !== null && _b !== void 0 ? _b : [])],
        playId: input.clientPlayId,
        continueCount: 0,
    };
}
function samePersistentActive(left, right) {
    return left !== null
        && left.playId === right.playId
        && left.questId === right.questId
        && left.category === right.category
        && left.useBossBoostPoint === right.useBossBoostPoint
        && left.useBoostPoint === right.useBoostPoint
        && left.isAutoStartMode === right.isAutoStartMode
        && left.isMulti === right.isMulti
        && left.roomNumber === right.roomNumber
        && left.continueCount === right.continueCount;
}
function createFiveBossBattleRuntime(overrides = {}) {
    var _a, _b;
    const givePlayerItemSync = (_a = overrides.givePlayerItemSync) !== null && _a !== void 0 ? _a : item_1.givePlayerItemSync;
    const givePlayerEquipmentSync = (_b = overrides.givePlayerEquipmentSync) !== null && _b !== void 0 ? _b : equipment_1.givePlayerEquipmentSync;
    const cursedWeaponPool = overrides.cursedWeaponPool;
    function start(input) {
        const frozen = validateFrozenStart(input);
        const result = (0, fiveBossGauntletRun_1.startMemberSync)({
            runId: frozen.runId,
            hostPlayerId: input.room.host_player_id,
            routeId: contract_1.FIVE_BOSS_GAUNTLET.routeId,
            roomNumber: input.requestRoomNumber,
            ticketItemId: contract_1.FIVE_BOSS_GAUNTLET.ticketItemId,
            hostStaminaCost: contract_1.FIVE_BOSS_GAUNTLET.staminaCost,
            rosterPlayerIds: frozen.rosterPlayerIds,
            playerId: input.playerId,
            clientPlayId: input.clientPlayId,
            isAutoMode: frozen.isAutoMode,
        }, context => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const activeQuest = buildActiveQuest(input, context.member.isAutoMode);
            activeQuest.startedAtMs = Date.parse(context.member.startedAt);
            const existing = (0, quest_active_1.getPlayerActiveQuestSync)(input.playerId);
            if (context.isReplay && (existing === null || existing === void 0 ? void 0 : existing.playId) === input.clientPlayId) {
                activeQuest.continueCount = existing.continueCount;
            }
            if (existing !== null && !samePersistentActive(existing, activeQuest)) {
                runtimeFail("active_quest_mismatch", "player already has a different persistent active quest");
            }
            (0, quest_active_1.insertPlayerActiveQuestSync)(input.playerId, {
                playerId: input.playerId,
                playId: activeQuest.playId,
                questId: activeQuest.questId,
                category: activeQuest.category,
                useBossBoostPoint: activeQuest.useBossBoostPoint,
                useBoostPoint: activeQuest.useBoostPoint,
                isAutoStartMode: activeQuest.isAutoStartMode,
                isMulti: activeQuest.isMulti,
                isMultiHost: activeQuest.isMultiHost === true,
                startedAtMs: (_a = activeQuest.startedAtMs) !== null && _a !== void 0 ? _a : null,
                roomNumber: (_b = activeQuest.roomNumber) !== null && _b !== void 0 ? _b : null,
                entryItemId: (_c = activeQuest.entryItemId) !== null && _c !== void 0 ? _c : null,
                eventId: (_d = activeQuest.eventId) !== null && _d !== void 0 ? _d : null,
                continueCount: activeQuest.continueCount,
            });
            if (!context.isReplay) {
                const ids = (_f = (_e = input.room.five_boss_runtime) === null || _e === void 0 ? void 0 : _e.partyCharacterIdsByPlayerId[String(input.playerId)]) !== null && _f !== void 0 ? _f : [];
                const loadout = (0, loadout_1.normalizeWeaponRivenLoadout)((_h = (_g = input.room.five_boss_runtime) === null || _g === void 0 ? void 0 : _g.weaponRivenLoadoutByPlayerId) === null || _h === void 0 ? void 0 : _h[String(input.playerId)]);
                (0, db_1.getDb)().prepare(`UPDATE five_boss_gauntlet_members
                    SET party_character_ids_json = ?, riven_loadout_json = ? WHERE run_id = ? AND player_id = ?`)
                    .run(JSON.stringify(ids), JSON.stringify(loadout), context.run.runId, input.playerId);
            }
            return activeQuest;
        });
        assertRunIdentity(result.run, input);
        return {
            startStatus: result.status,
            runId: result.run.runId,
            runStatus: result.run.status,
            activeQuest: result.persisted,
        };
    }
    function abort(input) {
        assertSpecialRequest(input);
        const result = (0, fiveBossGauntletRun_1.abortMemberSync)({
            playerId: input.playerId,
            clientPlayId: input.clientPlayId,
        }, context => {
            assertPersistentActiveQuest(context.run, context.member, input);
            (0, quest_active_1.deletePlayerActiveQuestSync)(input.playerId);
            return true;
        });
        assertRunIdentity(result.run, input);
        return {
            abortStatus: result.status,
            runId: result.run.runId,
            runStatus: result.run.status,
        };
    }
    function finish(input) {
        assertSpecialRequest(input);
        if (typeof input.accomplished !== "boolean") {
            runtimeFail("invalid_argument", "accomplished must be a boolean");
        }
        if (!input.accomplished) {
            const aborted = abort(input);
            return Object.assign({ kind: "failed" }, aborted);
        }
        const result = (0, fiveBossGauntletRun_1.settleMemberSync)({
            playerId: input.playerId,
            clientPlayId: input.clientPlayId,
        }, context => {
            var _a, _b;
            assertPersistentActiveQuest(context.run, context.member, input);
            const previous = (0, quest_1.getPlayerSingleQuestProgressSync)(input.playerId, contract_1.FIVE_BOSS_GAUNTLET.category, contract_1.FIVE_BOSS_GAUNTLET.visibleQuestId);
            const firstClear = (previous === null || previous === void 0 ? void 0 : previous.finished) !== true;
            const plan = (0, rewards_1.buildFiveBossGauntletRewardPlan)({
                firstClear,
                rewardMultiplier: context.rewardMultiplier,
                randomFloat: input.randomFloat,
            });
            const itemTotals = {};
            const grantedItems = plan.items.map(item => {
                const total = givePlayerItemSync(input.playerId, item.itemId, item.amount);
                itemTotals[String(item.itemId)] = total;
                return Object.assign(Object.assign({}, item), { total });
            });
            // 武器与材料共用本次结算的随机序列；命中 id 写入 receipt，重放时由 HTTP
            // 层读取并序列化当前持有状态，避免重复发放。
            const weaponPlan = (0, rewards_1.buildFiveBossCursedWeaponDropPlan)({
                rewardMultiplier: context.rewardMultiplier,
                availableEquipmentIds: cursedWeaponPool !== null && cursedWeaponPool !== void 0 ? cursedWeaponPool : (0, rewards_1.getFiveBossCursedWeaponPool)(),
                randomFloat: input.randomFloat,
            });
            for (const equipmentId of weaponPlan.equipmentIds) {
                givePlayerEquipmentSync(input.playerId, equipmentId, 1);
            }
            const rivens = (0, weaponRiven_1.convertUnknownWeaponRivensSync)(input.playerId, (0, battle_1.getMultiWeaponRivenLoadoutSync)(input.playerId, context.run.runId), `five-boss:multi:${context.run.runId}`, input.randomFloat);
            Object.assign(itemTotals, rivens.item_list);
            const storedParty = (0, db_1.getDb)().prepare(`SELECT party_character_ids_json
                FROM five_boss_gauntlet_members WHERE run_id = ? AND player_id = ?`)
                .get(context.run.runId, input.playerId);
            const ids = JSON.parse(storedParty.party_character_ids_json);
            const quest = (0, assets_1.getQuestFromCategorySync)(contract_1.FIVE_BOSS_GAUNTLET.category, contract_1.FIVE_BOSS_GAUNTLET.visibleQuestId);
            const characterExp = ids.length
                ? (0, character_1.givePlayerCharactersExpSync)(input.playerId, ids, (_a = quest === null || quest === void 0 ? void 0 : quest.characterExpReward) !== null && _a !== void 0 ? _a : 0, false)
                : null;
            updateSuccessfulQuestProgress(input.playerId, Object.assign(Object.assign({}, input), { leaderCharacterId: (_b = ids[0]) !== null && _b !== void 0 ? _b : null }), previous);
            (0, quest_active_1.deletePlayerActiveQuestSync)(input.playerId);
            return {
                firstClear,
                grantedItems,
                itemTotals,
                characterExp,
                grantedEquipment: weaponPlan.equipmentIds,
                weapon_riven_list: rivens.weapon_riven_list,
                weapon_riven_deleted: rivens.weapon_riven_deleted,
                weapon_riven_granted: rivens.weapon_riven_granted,
                weapon_riven_auto_dismantled: rivens.weapon_riven_auto_dismantled,
                party_info_list: rivens.party_info_list,
            };
        });
        assertRunIdentity(result.run, input);
        return {
            kind: "success",
            receiptStatus: result.status,
            runId: result.run.runId,
            runStatus: result.run.status,
            rewardMultiplier: result.rewardMultiplier,
            reward: result.reward,
        };
    }
    return { start, finish, abort };
}
exports.createFiveBossBattleRuntime = createFiveBossBattleRuntime;
const defaultRuntime = createFiveBossBattleRuntime();
exports.startFiveBossBattle = defaultRuntime.start;
exports.finishFiveBossBattle = defaultRuntime.finish;
exports.abortFiveBossBattle = defaultRuntime.abort;
