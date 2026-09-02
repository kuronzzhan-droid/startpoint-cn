import { Player, PlayerRushEvent, RushEventBattleType, UserRushEventEndlessBattleMyRankingPartyMemberListItem, UserRushEventEndlessBattleRanking, UserRushEventPlayedPartyList } from "../data/types";
import { getPlayerIdFromRushEventEndlessRankSync, getPlayerRushEventPlayedPartiesSync, getPlayerRushEventSync, serializePlayerRushEventPlayedParty } from "../data/domains/rushEvent"
import { getPlayerSync } from "../data/domains/player"
import { getRogueEventConfig, getRushEventQuestRound } from "./assets"
import { getRankDegree } from "./stamina"
import { SerializedPlayerRushEventPlayedPartyList, SerializedPlayerRushEventPlayedParties } from "./types";
import { dispatchModeRushParties, type ModeHost } from "../modes/registry";
import { hideFantasyBossPlayedPartyMembers } from "./fantasy-gauntlet/played-party";
import { createModeHost } from "../modes/host";

// Lazy construction avoids closing the existing import cycle through assets.
let rushModeHost: ModeHost | null = null

function modeHost(): ModeHost {
    if (rushModeHost === null) {
        rushModeHost = createModeHost(message => console.log(message))
    }
    return rushModeHost
}

/**
 * How many party slots a rush ranking row carries.
 *
 * The official client builds its thumbnail array from `party_member_list.length`
 * and then only calls `show()` on the slots it filled. List cells are recycled,
 * so a row that sends fewer than 3 entries leaves the previous row's avatars on
 * screen. Empty slots must therefore be sent explicitly as nulls.
 */
export const RUSH_RANKING_PARTY_SLOTS = 3

/**
 * Pads/truncates a party to exactly {@link RUSH_RANKING_PARTY_SLOTS} slots,
 * keeping slot positions (slot 2 stays slot 2 even when slot 1 is empty).
 *
 * @param characterIds Character ID per slot; missing/null entries become empty slots.
 * @param evolutionImgLevels Evolution image level per slot.
 * @returns Exactly 3 party member entries.
 */
export function buildRushRankingPartyMemberList(
    characterIds: readonly (number | null | undefined)[],
    evolutionImgLevels: readonly (number | null | undefined)[]
): UserRushEventEndlessBattleMyRankingPartyMemberListItem[] {
    const list: UserRushEventEndlessBattleMyRankingPartyMemberListItem[] = []
    for (let slot = 0; slot < RUSH_RANKING_PARTY_SLOTS; slot++) {
        const characterId = characterIds[slot] ?? null
        list.push({
            character_id: characterId,
            // The client clamps >1 down to 1 and throws ClientError(2027) on a
            // negative, so an empty slot sends null and a filled one sends 0/1.
            evolution_img_level: characterId === null ? null : (evolutionImgLevels[slot] ?? 0)
        })
    }
    return list
}

/**
 * Gets all of a player's played parties, serializes them into client formant, and organizes them by their RushEventBattleType.
 * 
 * @param playerId The ID of the player.
 * @param eventId The ID of the rush event.
 * @returns The serialized parties organized by type.
 */
export function getSerializedPlayerRushEventPlayedPartiesSync(
    playerId: number,
    eventId: number
): SerializedPlayerRushEventPlayedParties {
    // get played parties
    const playedParties = getPlayerRushEventPlayedPartiesSync(playerId, eventId)

    // convert played parties to the expected client format
    const rushBattlePlayedPartyList: SerializedPlayerRushEventPlayedPartyList = {}
    const endlessBattlePlayedPartyList: SerializedPlayerRushEventPlayedPartyList = {}

    for (const party of playedParties) {
        const record = party.battleType === RushEventBattleType.FOLDER ? rushBattlePlayedPartyList : endlessBattlePlayedPartyList;
        record[party.round] = serializePlayerRushEventPlayedParty(party)
    }

    // rogue mode: strip member ids from played parties before sending them to
    // the client. Character locking (RushEventPartyGroupHolder) is derived
    // purely from these lists, so scrubbed entries release the lock while the
    // preserved entry count keeps folder round progression intact
    // (client getRushBattleRound() = list size + 1).
    if (getRogueEventConfig(eventId)?.unlock_played_parties === true) {
        for (const record of [rushBattlePlayedPartyList, endlessBattlePlayedPartyList]) {
            for (const party of Object.values(record)) {
                party.character_id_1 = party.character_id_2 = party.character_id_3 = null
                party.unison_character_id_1 = party.unison_character_id_2 = party.unison_character_id_3 = null
                party.evolution_img_level_1 = party.evolution_img_level_2 = party.evolution_img_level_3 = null
                party.unison_evolution_img_level_1 = party.unison_evolution_img_level_2 = party.unison_evolution_img_level_3 = null
            }
        }
    }

    // 幻想连战(700098)的 5/10/15 是多人 boss,通关标记由服务端补写。
    // 那三条标记只是「这一轮过了」的占位,不该占用角色 —— 多人段用的是另一套
    // 队伍。抹掉成员 id 后角色锁解开,而记录条数(= 下一轮号)一格不动。
    // 只按事件号命中,深渊连战 700099 走上面那条 rogue 分支,与这里无关。
    hideFantasyBossPlayedPartyMembers(eventId, rushBattlePlayedPartyList)

    // Installed modes may adjust the records the client uses for character
    // locking. Dispatch after the built-in rogue rewrite so modes see the
    // final baseline representation. No loaded modes means a strict no-op.
    dispatchModeRushParties({
        playerId,
        eventId,
        folderParties: rushBattlePlayedPartyList as unknown as Record<number, Record<string, unknown>>,
        endlessParties: endlessBattlePlayedPartyList as unknown as Record<number, Record<string, unknown>>,
    }, modeHost())

    // return parties
    return {
        folderParties: rushBattlePlayedPartyList,
        endlessParties: endlessBattlePlayedPartyList
    }
}

/**
 * Converts player data & rush event data into the format that the client expects for rush event endless battle rankings.
 * 
 * @param playerId The ID of the player.
 * @param eventId The ID of the rush event.
 * @param playerData Existing data to use instead of fetching brand new data.
 * @returns A UserRushEventEndlessBattleRanking object or null.
 */
export function getPlayerRushEventEndlessBattleRankingSync(
    playerId: number,
    eventId: number,
    useData?: {
        playerData?: Player,
        rushEventData?: PlayerRushEvent,
        rankNumber?: number | null
    }
): UserRushEventEndlessBattleRanking | null {

    const playerData = useData?.playerData === undefined ? getPlayerSync(playerId) : useData?.playerData
    if (playerData === null) return null;

    const rushEventData = useData?.rushEventData === undefined ? getPlayerRushEventSync(playerId, eventId) : useData?.rushEventData
    if (rushEventData === null) return null;

    const bestRound = rushEventData.endlessBattleMaxRound
    const bestTime = rushEventData.endlessBattleMaxRoundTime
    const endlessCharacterIds = rushEventData.endlessBattleMaxRoundCharacterIds
    const endlessCharacterEvolutionImgLevel = rushEventData.endlessBattleMaxRoundCharacterEvolutionImgLvls 
    if (bestRound === null || bestTime === null || endlessCharacterIds === null || endlessCharacterEvolutionImgLevel === null)
        return null;

    // Build the party member list. Always exactly 3 slots - see
    // buildRushRankingPartyMemberList for why a short list is a real defect.
    const partyMemberList = buildRushRankingPartyMemberList(
        endlessCharacterIds,
        endlessCharacterEvolutionImgLevel
    )

    return {
        best_round: bestRound,
        elapsed_time_ms: bestTime,
        name: playerData.name,
        party_member_list: partyMemberList,
        // Unknown rank sends null (rank text blank, rank flag hidden). Sending 0
        // means "out of ranking", which is a different - and wrong - statement
        // when the caller simply never computed a rank.
        rank_number: useData?.rankNumber ?? null,
        // Real account level. This used to be hardcoded to 215 for everyone.
        user_rank: getRankDegree(playerData.rankPoint)
    }
}

/**
 * Gets the played party list for the player currently at a rank in an endless battle leaderboard for a rush event.
 * 
 * @param rank The rank of the player.
 * @param eventId The ID of the rush event.
 * @returns A serialized player rush event played party list or null.
 */
export function getRushEventEndlessBattleRankPlayedPartyListSync(
    rank: number,
    eventId: number
): SerializedPlayerRushEventPlayedPartyList | null {
    // Get the ID of the player who is currently at rank [rank].
    const playerId = getPlayerIdFromRushEventEndlessRankSync(rank, eventId);
    if (playerId === null) return null;

    // get the played party list
    const parties = getSerializedPlayerRushEventPlayedPartiesSync(playerId, eventId);

    return parties.endlessParties;
}

/**
 * 取某个存档在某个连战事件里 **folder(塔)模式** 的逐轮出战队伍,按轮次号索引。
 *
 * 和 {@link getSerializedPlayerRushEventPlayedPartiesSync} 的区别:**不做 rogue 洗号**。
 * 那道洗号存在的理由是解开客户端的「角色已用锁」(它纯粹由这张表推导),代价是把
 * character_id 全抹成 null。排行榜的编队子页要的正好是这些 ID —— 洗过之后点开
 * 只会看到一排空头像。
 *
 * 键是**第几战(1..N)**,不是 quest id —— 见函数体里的换算注释。
 *
 * @param playerId 存档 ID。
 * @param eventId 连战事件 ID。
 * @returns 轮次号 → 队伍。
 */
export function getRushRankingPlayedPartyListSync(
    playerId: number,
    eventId: number
): SerializedPlayerRushEventPlayedPartyList {
    const parties = getPlayerRushEventPlayedPartiesSync(playerId, eventId)
        .filter(party => party.battleType === RushEventBattleType.FOLDER)

    // 轮次标签换算(方案文档 §8.4 第 3 条的拍板):这张表里 `round` 存的是 **quest id**
    // (`rush-handler.ts` 的 `let round: number = questId`),而客户端把这个 Map 的键
    // 直接渲染成「在第::value::回战使用的队伍」 => 不换算就是「在第700099001回战」。
    // 换算走 `rush_event_quest.json` 自己的 `rushEventRound` 列。
    //
    // **只在换算结果一一对应时才用它**:两个 folder 的同名轮次会撞键,撞了就整体
    // 退回 quest id —— 宁可标签难看,也不能悄悄少发一支队伍。
    const rounds = parties.map(party => getRushEventQuestRound(party.round))
    const usable = rounds.every(round => round !== null && round > 0)
        && new Set(rounds).size === rounds.length

    const list: SerializedPlayerRushEventPlayedPartyList = {}
    parties.forEach((party, index) => {
        const key = usable ? rounds[index]! : party.round
        list[key] = serializePlayerRushEventPlayedParty(party)
    })
    return list
}
