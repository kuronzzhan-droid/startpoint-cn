import { getDb } from "../db";
import { getServerTime } from "../../utils";

export const MAX_FOLLOWING = 50;
export const MAX_FOLLOWERS = 50;

interface RawFollow {
    follower_player_id: number;
    followed_player_id: number;
    created_at: number;
}

export interface FollowRelation {
    state: 0 | 1 | 2 | 3;
    followTime: number | null;
    followedTime: number | null;
}

export type AddFollowResult =
    | "added"
    | "exists"
    | "self"
    | "target_not_found"
    | "following_limit"
    | "follower_limit";

export function getPlayerIdByViewerIdSync(viewerId: number): number | null {
    const row = getDb().prepare(`
        SELECT p.id
        FROM sessions s
        INNER JOIN players p ON p.account_id = s.account_id
        WHERE s.token = ? AND s.type = 2
        LIMIT 1
    `).get(String(viewerId)) as { id: number } | undefined;
    return row?.id ?? null;
}

export function getViewerIdByPlayerIdSync(playerId: number): number | null {
    const row = getDb().prepare(`
        SELECT s.token
        FROM players p
        INNER JOIN sessions s ON s.account_id = p.account_id AND s.type = 2
        WHERE p.id = ?
        LIMIT 1
    `).get(playerId) as { token: string } | undefined;
    if (!row) return null;
    const viewerId = Number(row.token);
    return Number.isFinite(viewerId) ? viewerId : null;
}

export function getRelatedPlayerIdsSync(playerId: number): number[] {
    const rows = getDb().prepare(`
        SELECT CASE
            WHEN follower_player_id = @player_id THEN followed_player_id
            ELSE follower_player_id
        END AS related_player_id
        FROM players_follows
        WHERE follower_player_id = @player_id OR followed_player_id = @player_id
        GROUP BY related_player_id
    `).all({ player_id: playerId }) as Array<{ related_player_id: number }>;
    return rows.map(row => row.related_player_id);
}

export function getFollowRelationSync(playerId: number, targetPlayerId: number): FollowRelation {
    const rows = getDb().prepare(`
        SELECT follower_player_id, followed_player_id, created_at
        FROM players_follows
        WHERE (follower_player_id = ? AND followed_player_id = ?)
           OR (follower_player_id = ? AND followed_player_id = ?)
    `).all(playerId, targetPlayerId, targetPlayerId, playerId) as RawFollow[];

    let followTime: number | null = null;
    let followedTime: number | null = null;
    for (const row of rows) {
        if (row.follower_player_id === playerId) followTime = row.created_at;
        if (row.follower_player_id === targetPlayerId) followedTime = row.created_at;
    }

    const state: FollowRelation["state"] = followTime !== null
        ? (followedTime !== null ? 1 : 2)
        : (followedTime !== null ? 3 : 0);
    return { state, followTime, followedTime };
}

export function getFollowingCountSync(playerId: number): number {
    const row = getDb().prepare(`
        SELECT COUNT(*) AS count FROM players_follows WHERE follower_player_id = ?
    `).get(playerId) as { count: number };
    return row.count;
}

export function getFollowerCountSync(playerId: number): number {
    const row = getDb().prepare(`
        SELECT COUNT(*) AS count FROM players_follows WHERE followed_player_id = ?
    `).get(playerId) as { count: number };
    return row.count;
}

export function addFollowSync(playerId: number, targetPlayerId: number): AddFollowResult {
    if (playerId === targetPlayerId) return "self";
    const target = getDb().prepare(`SELECT id FROM players WHERE id = ?`).get(targetPlayerId);
    if (!target) return "target_not_found";

    const existing = getDb().prepare(`
        SELECT 1 FROM players_follows
        WHERE follower_player_id = ? AND followed_player_id = ?
    `).get(playerId, targetPlayerId);
    if (existing) return "exists";
    if (getFollowingCountSync(playerId) >= MAX_FOLLOWING) return "following_limit";
    if (getFollowerCountSync(targetPlayerId) >= MAX_FOLLOWERS) return "follower_limit";

    getDb().prepare(`
        INSERT INTO players_follows (follower_player_id, followed_player_id, created_at)
        VALUES (?, ?, ?)
    `).run(playerId, targetPlayerId, getServerTime());
    return "added";
}

export function deleteFollowSync(playerId: number, targetPlayerId: number): void {
    getDb().prepare(`
        DELETE FROM players_follows
        WHERE follower_player_id = ? AND followed_player_id = ?
    `).run(playerId, targetPlayerId);
}

export function deleteFollowerSync(playerId: number, followerPlayerId: number): void {
    getDb().prepare(`
        DELETE FROM players_follows
        WHERE follower_player_id = ? AND followed_player_id = ?
    `).run(followerPlayerId, playerId);
}

export function bulkEditFollowSync(
    playerId: number,
    addTargetPlayerIds: number[],
    deleteTargetPlayerIds: number[],
): number[] {
    const fullFollowerTargets = new Set<number>();
    getDb().transaction(() => {
        for (const targetPlayerId of new Set(deleteTargetPlayerIds)) {
            deleteFollowSync(playerId, targetPlayerId);
        }
        for (const targetPlayerId of new Set(addTargetPlayerIds)) {
            const result = addFollowSync(playerId, targetPlayerId);
            if (result === "follower_limit") fullFollowerTargets.add(targetPlayerId);
            if (result === "following_limit") break;
        }
    })();
    return [...fullFollowerTargets];
}
