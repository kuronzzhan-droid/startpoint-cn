import { cdnCharacters as characterMaster } from "../content-master"
import { getPlayerSync } from "../../data/domains/player"
import { getViewerIdByPlayerIdSync } from "../../data/domains/follow"
import {
    getLeaderboardRankPageAndPlayerSync,
    getLeaderboardRankPageSync,
    getLeaderboardRunRoundsSync,
    LeaderboardRankRecord,
} from "../../data/domains/leaderboard"
import { serializePlayerRushEventPlayedParty } from "../../data/domains/rushEvent"
import {
    getFirstPlayerPartyDisplaySelectionsSync,
    PlayerPartyDisplaySelection,
} from "../../data/domains/party"
import { getRankDegree } from "../stamina"
import { PROFILE_FAVORITE_PARTY_CATEGORY } from "../profileFavorite"
import {
    getLeaderboardCompetitionSeasonSync,
    LeaderboardCompetition,
} from "./competition"
import { isPercentRewardTier, LeaderboardRewardTier, resolveLeaderboardRewardTiers } from "./rewards"
import { getLeaderboardSeasonRewardViewSync, getLeaderboardSettlementConfigSync, LeaderboardSeasonRewardView } from "./settlement"
import { isLeaderboardDeadlineDueSync, isLeaderboardEnabledSync } from "./availability"
import { formatLeaderboardDeadlineInput } from "./schedule-time"
export {
    RUSH_PROFILE_ID_BASE,
    fromProfileTargetId,
    toProfileTargetId,
} from "../profile-target"

function getRealProfileViewerId(playerId: number): number {
    // The leaderboard stores a player archive id, but the client profile API
    // requires the player's real viewer/session id. Never expose the archive
    // id as a fake viewer id; rows without a live identity are not clickable.
    return getViewerIdByPlayerIdSync(playerId) ?? 0
}

export interface OfficialLeaderboardRow {
    rank_number: number
    clear_count: number | null
    best_round: number
    elapsed_time_ms: number
    name: string
    party_member_list: { character_id: number, evolution_img_level: number }[]
    user_rank: number
}

export interface NativeLeaderboardRow {
    rank: string
    visible: boolean
    level: string
    name: string
    count: string
    time: string
    a: string | null
    b: string | null
    c: string | null
    id: number
}

function formatTime(ms: number): string {
    const value = Math.max(0, Math.trunc(ms))
    const minutes = Math.floor(value / 60_000)
    const seconds = Math.floor(value / 1_000) % 60
    const centiseconds = Math.floor(value / 10) % 100
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`
}

function thumbnailPath(characterId: number | null, evolutionLevel: number | null): string | null {
    if (characterId === null || (characterId >= 700000 && characterId <= 700099)) return null
    const entry = (characterMaster as Record<string, unknown>)[String(characterId)]
    const row = Array.isArray(entry) && Array.isArray(entry[0]) ? entry[0] : entry
    const codeName = Array.isArray(row) && typeof row[0] === "string" ? row[0] : null
    if (codeName === null || codeName === "") return null
    const level = Math.max(0, Math.min(1, Math.trunc(evolutionLevel ?? 0)))
    return `character/${codeName}/ui/thumb_party_unison_${level}`
}

function displayedParty(
    record: LeaderboardRankRecord,
    favorite: PlayerPartyDisplaySelection | undefined,
): PlayerPartyDisplaySelection {
    const characterIds: (number | null)[] = []
    const evolutionImgLevels: (number | null)[] = []
    for (let slot = 0; slot < 3; slot++) {
        const favoriteId = favorite?.characterIds[slot] ?? null
        const favoriteLevel = favorite?.evolutionImgLevels[slot] ?? null
        if (thumbnailPath(favoriteId, favoriteLevel) !== null) {
            characterIds.push(favoriteId)
            evolutionImgLevels.push(favoriteLevel)
        } else {
            characterIds.push(record.characterIds[slot] ?? null)
            evolutionImgLevels.push(record.evolutionImgLevels[slot] ?? null)
        }
    }
    return { characterIds, evolutionImgLevels }
}

function officialRow(
    record: LeaderboardRankRecord,
    favorite: PlayerPartyDisplaySelection | undefined,
): OfficialLeaderboardRow {
    const party = displayedParty(record, favorite)
    return {
        rank_number: record.rankNumber,
        clear_count: record.clearCount,
        best_round: record.totalRounds,
        elapsed_time_ms: record.clientBattleMs,
        name: record.displayName,
        party_member_list: party.characterIds.flatMap((characterId, slot) =>
            characterId === null ? [] : [{
                character_id: characterId,
                evolution_img_level: party.evolutionImgLevels[slot] ?? 0,
            }]),
        user_rank: getRankDegree(record.rankPoint),
    }
}

export function nativeRow(
    record: LeaderboardRankRecord,
    favorite?: PlayerPartyDisplaySelection,
): NativeLeaderboardRow {
    const party = displayedParty(record, favorite)
    const paths = party.characterIds.map((id, slot) =>
        thumbnailPath(id, party.evolutionImgLevels[slot] ?? 0))
    return {
        rank: `${record.rankNumber}位`,
        visible: true,
        level: `RANK${getRankDegree(record.rankPoint)}`,
        name: record.displayName,
        count: `通关次数：${record.clearCount === null ? "未记录" : `${record.clearCount}次`}`,
        time: `TIME: ${formatTime(record.clientBattleMs)}`,
        a: paths[0] ?? null,
        b: paths[1] ?? null,
        c: paths[2] ?? null,
        id: record.playerExists ? getRealProfileViewerId(record.playerId) : 0,
    }
}

function outOfRankRow(playerId: number): NativeLeaderboardRow | null {
    const player = getPlayerSync(playerId)
    if (player === null) return null
    return {
        rank: "排名外",
        visible: false,
        level: `RANK${getRankDegree(player.rankPoint)}`,
        name: player.name,
        count: "通关次数：0次",
        time: "TIME: --:--.--",
        a: null,
        b: null,
        c: null,
        id: getRealProfileViewerId(playerId),
    }
}

export function getOfficialLeaderboardPageSync(input: {
    competition: LeaderboardCompetition
    playerId: number
    page: number
    acceptingScores?: boolean
}): {
    currentPage: number
    pageMax: number
    total: number
    myData: OfficialLeaderboardRow | null
    rows: OfficialLeaderboardRow[]
} {
    const season = getDisplaySeason(input.competition.key, input.acceptingScores ?? true)
    const { total, filter } = getLeaderboardSeasonRewardViewSync(input.competition.key, season)
    const visibleTotal = Math.min(total, input.competition.displayLimit)
    const pageMax = Math.max(1, Math.ceil(visibleTotal / input.competition.pageSize))
    const requestedPage = Number.isFinite(input.page) ? Math.trunc(input.page) : 0
    const page = Math.max(0, Math.min(requestedPage, pageMax - 1))
    const { rows, mine } = getLeaderboardRankPageAndPlayerSync({
        competitionKey: input.competition.key,
        season,
        playerId: input.playerId,
        offset: page * input.competition.pageSize,
        filter,
        limit: Math.min(
            input.competition.pageSize,
            Math.max(0, input.competition.displayLimit - page * input.competition.pageSize),
        ),
    })
    const favorites = getFirstPlayerPartyDisplaySelectionsSync(
        [
            ...rows.map(record => record.playerId),
            ...(mine === null ? [] : [mine.playerId]),
        ],
        PROFILE_FAVORITE_PARTY_CATEGORY,
    )
    return {
        currentPage: page + 1,
        pageMax,
        total,
        myData: mine === null ? null : officialRow(mine, favorites.get(mine.playerId)),
        rows: rows.map(record => officialRow(record, favorites.get(record.playerId))),
    }
}

export function getLeaderboardPlayedPartiesSync(input: {
    competition: LeaderboardCompetition
    rankNumber: number
    acceptingScores?: boolean
}): Record<number, ReturnType<typeof serializePlayerRushEventPlayedParty>> {
    const season = getDisplaySeason(input.competition.key, input.acceptingScores ?? true)
    if (!Number.isInteger(input.rankNumber) || input.rankNumber < 1) return {}
    const [record] = getLeaderboardRankPageSync({
        competitionKey: input.competition.key,
        season,
        offset: input.rankNumber - 1,
        limit: 1,
        filter: getLeaderboardSeasonRewardViewSync(input.competition.key, season).filter,
    })
    if (record === undefined) return {}
    return Object.fromEntries(getLeaderboardRunRoundsSync(record.id).map(round => [
        round.roundNumber,
        serializePlayerRushEventPlayedParty({
            characterIds: round.characterIds,
            unisonCharacterIds: round.unisonCharacterIds,
            equipmentIds: round.equipmentIds,
            abilitySoulIds: round.abilitySoulIds,
            evolutionImgLevels: round.evolutionImgLevels,
            unisonEvolutionImgLevels: round.unisonEvolutionImgLevels,
            round: round.roundNumber,
            battleType: 1,
        }),
    ]))
}

export function buildNativeLeaderboardPayload(
    competition: LeaderboardCompetition,
    playerId: number | null,
    acceptingScores: boolean = true,
    nowMs: number = Date.now(),
): {
    enabled: true
    name: string
    rows: NativeLeaderboardRow[]
    item: NativeLeaderboardRow | null
    page: number
    row: number
    index: number
    time: string
    total: number
    reward: readonly LeaderboardRewardTier[]
} {
    acceptingScores = isLeaderboardEnabledSync(competition.key, nowMs) && acceptingScores
    const season = getDisplaySeason(competition.key, acceptingScores, nowMs)
    const rewardView = getLeaderboardSeasonRewardViewSync(competition.key, season)
    const { total, filter, settled } = rewardView
    const rewardPresentation = buildLeaderboardRewardPresentation(competition, rewardView)
    const { rows: records, mine } = getLeaderboardRankPageAndPlayerSync({
        competitionKey: competition.key,
        season,
        playerId,
        offset: 0,
        limit: competition.displayLimit,
        filter,
    })
    const favorites = getFirstPlayerPartyDisplaySelectionsSync(
        [
            ...records.map(record => record.playerId),
            ...(mine === null ? [] : [mine.playerId]),
        ],
        PROFILE_FAVORITE_PARTY_CATEGORY,
    )
    const index = mine === null ? -1 : mine.rankNumber - 1
    const visibleIndex = index >= 0 && index < records.length ? index : -1
    return {
        enabled: true,
        name: rewardPresentation.name,
        rows: records.map(record => nativeRow(record, favorites.get(record.playerId))),
        item: mine === null
            ? (playerId === null ? null : outOfRankRow(playerId))
            : nativeRow(mine, favorites.get(mine.playerId)),
        page: visibleIndex < 0 ? 0 : Math.floor(visibleIndex / competition.pageSize),
        row: visibleIndex < 0 ? -1 : visibleIndex % competition.pageSize,
        index,
        time: buildLeaderboardScheduleText(competition.key, acceptingScores, settled),
        total,
        reward: rewardPresentation.rewardTiers,
    }
}

function buildLeaderboardScheduleText(competitionKey: string, acceptingScores: boolean, settled: boolean): string {
    if (settled) return "已结算"
    if (!acceptingScores) return "已冻结，待结算"
    const config = getLeaderboardSettlementConfigSync(competitionKey)
    if (config.settleAtMs === null) return "实时更新"
    if (!config.freezeEnabled && !config.autoEnabled) return "未启用定时结算"
    const beijing = formatLeaderboardDeadlineInput(config.settleAtMs).slice(5).replace("T", " ")
    return `${config.autoEnabled ? "结算" : "截止"}：${beijing}`
}

export function buildUnavailableNativeLeaderboardPayload(): {
    enabled: false
    name: string
    rows: NativeLeaderboardRow[]
    item: null
    page: number
    row: number
    index: number
    time: string
    total: number
    reward: readonly LeaderboardRewardTier[]
} {
    return {
        enabled: false,
        name: "连战",
        rows: [],
        item: null,
        page: 0,
        row: -1,
        index: -1,
        time: "排行榜暂未开放",
        total: 0,
        reward: [],
    }
}

function getSeason(competitionKey: string): number {
    return getLeaderboardCompetitionSeasonSync(competitionKey)
}

function getDisplaySeason(competitionKey: string, acceptingScores: boolean, nowMs = Date.now()): number {
    const currentSeason = getSeason(competitionKey)
    const current = getLeaderboardSeasonRewardViewSync(competitionKey, currentSeason)
    if (acceptingScores || current.total > 0 || current.settled
        || isLeaderboardDeadlineDueSync(competitionKey, nowMs)) {
        return currentSeason
    }
    for (let season = currentSeason - 1; season >= 1; season--) {
        if (getLeaderboardSeasonRewardViewSync(competitionKey, season).total > 0) return season
    }
    return currentSeason
}

export function buildLeaderboardTermsText(competition: LeaderboardCompetition, acceptingScores = true): string {
    const season = getDisplaySeason(competition.key, acceptingScores)
    const view = getLeaderboardSeasonRewardViewSync(competition.key, season)
    const { name, rewardTiers: tiers } = buildLeaderboardRewardPresentation(competition, view)
    const lines = tiers.map(tier => {
        const range = tier.toRank === null
            ? `第${tier.fromRank}名起`
            : tier.fromRank === tier.toRank
                ? `第${tier.fromRank}名`
                : `第${tier.fromRank}～${tier.toRank}名`
        const rewards = [
            tier.itemId === null ? null : `${tier.itemName} × ${tier.itemCount}`,
            tier.degreeId === null ? null : `称号「${tier.degreeName}」`,
        ].filter((value): value is string => value !== null)
        return `<p><b>${range}</b>　${rewards.join(" + ")}</p>`
    })
    return `<h2>${name} 排行报酬</h2>${lines.join("")}<p>排行榜按本期完整通关的 client_battle_ms 总和升序排列；每位玩家只保留最佳成绩。</p>`
}

function buildLeaderboardRewardPresentation(
    competition: LeaderboardCompetition, view: LeaderboardSeasonRewardView,
): { name: string; rewardTiers: LeaderboardRewardTier[] } {
    if (view.total === 0 && view.rewardRules.some(isPercentRewardTier)) {
        // Existing clients construct the reward page from name + rank ranges.
        // Keep the example confined to presentation: the real count, ranks,
        // settlement tiers and saved results must remain empty for zero players.
        const label = view.settled ? "本期无人获奖；按100人参榜预览" : "按100人参榜预览"
        return {
            name: `${competition.displayName}（${label}）`,
            rewardTiers: resolveLeaderboardRewardTiers(view.rewardRules, 100),
        }
    }
    return { name: competition.displayName, rewardTiers: view.rewardTiers }
}
