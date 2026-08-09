import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPlayerCarnivalEventRecordsSync, migrateCarnivalEventFolderRecordsSync } from "../../data/domains/carnivalEvent"
import { getPlayerPartyGroupListSync, insertPlayerPartyGroupListSync, updatePlayerPartySync } from "../../data/domains/party"
import { getPlayerSync } from "../../data/domains/player"
import { getSession } from "../../data/domains/session"
import { resolvePlayerIdSync } from "../../data/activeAccount";
import { getDefaultPlayerPartyGroupsSync } from "../../data/domains/player";
import { serializePartyGroupList } from "../../data/utils";
import { generateDataHeaders } from "../../utils";
import { PartyCategory } from "../../data/types";

interface IndexBody {
    event_id: number,
    viewer_id: number,
    api_count: number
}

// The Carnival party selector is a fixed-width three-tab view.  Returning the
// generic twelve party groups compresses the labels until the tab decoration
// overlaps "SET" and makes groups 10-12 wrap onto two lines.
const CARNIVAL_PARTY_GROUP_COUNT = 3

function buildCarnivalPartyGroupList(playerId: number): any[] {
    // The client saves Haniwa Carnival parties with category 2.  Reading the
    // generic event category (4) returned a different default pool on every
    // visit, even though /party/edit had correctly persisted the changes.
    const carnivalCategory = PartyCategory.CARNIVAL
    let groups = getPlayerPartyGroupListSync(playerId, carnivalCategory)

    // /party/edit creates only the slots a player has touched.  Complete the
    // official 3x10 Carnival pool without overwriting saved compositions.
    // Extra groups from the earlier twelve-group bug remain in the database;
    // they are deliberately ignored here instead of being deleted.
    const defaults = getDefaultPlayerPartyGroupsSync(carnivalCategory)
    const missingGroups: typeof defaults = {}
    let insertedMissingSlots = false
    for (const [groupId, defaultGroup] of Object.entries(defaults)) {
        if (Number(groupId) > CARNIVAL_PARTY_GROUP_COUNT) continue
        const existingGroup = groups[groupId]
        if (!existingGroup) {
            missingGroups[groupId] = defaultGroup
            continue
        }
        for (const [slot, defaultParty] of Object.entries(defaultGroup.list)) {
            if (existingGroup.list[slot]) continue
            updatePlayerPartySync(playerId, Number(slot), defaultParty, Number(groupId))
            insertedMissingSlots = true
        }
    }
    if (Object.keys(missingGroups).length > 0) {
        insertPlayerPartyGroupListSync(playerId, missingGroups)
    }
    if (insertedMissingSlots || Object.keys(missingGroups).length > 0) {
        groups = getPlayerPartyGroupListSync(playerId, carnivalCategory)
    }

    const serialized = serializePartyGroupList(groups);
    // Convert to array format the client expects
    const result: any[] = [];
    for (const [groupId, group] of Object.entries(serialized)) {
        const parsedGroupId = Number(groupId)
        if (parsedGroupId < 1 || parsedGroupId > CARNIVAL_PARTY_GROUP_COUNT) continue
        const partyList: any[] = [];
        const list = (group as any).list || {};
        for (const [partyId, party] of Object.entries(list)) {
            const p = party as any;
            partyList.push({
                "party_id": parseInt(partyId),
                "party_name": p.name || "Party",
                "party_edited": p.edited || false,
                "character_ids": p.character_ids || [null, null, null],
                "unison_character_ids": p.unison_character_ids || [null, null, null],
                "equipment_ids": p.equipment_ids || [null, null, null],
                "ability_soul_ids": p.ability_soul_ids || [null, null, null],
                "options": p.options || { "allow_other_players_to_heal_me": true }
            });
        }
        result.push({
            "party_group_id": parsedGroupId,
            "party_group_color_id": (group as any).color_id || 0,
            "party_list": partyList
        });
    }
    return result;
}

const routes = async (fastify: FastifyInstance) => {
    fastify.post("/index", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as IndexBody;

        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        });

        const viewerIdSession = await getSession(viewerId.toString());
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        });

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!;
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        });

        const partyGroups = buildCarnivalPartyGroupList(playerId);

        // Build records from DB
        const eventId = body.event_id
        // Normalize historical 1..9 difficulty rows into the three displayed
        // folders for every elemental Haniwa Carnival, not only event 250606.
        migrateCarnivalEventFolderRecordsSync(eventId)
        const dbRecords = getPlayerCarnivalEventRecordsSync(playerId, eventId)
        const records = dbRecords.map(r => ({
            folder_id: r.folderId,
            best_score: r.bestScore,
            // This screen represents the retained per-folder record.  Sending
            // the most recent lower attempt here makes the graph look as if a
            // high score was overwritten.
            previous_score: r.bestScore,
            previous_character_ids: r.previousCharacterIds ?? [null, null, null],
            previous_unison_character_ids: r.previousUnisonCharacterIds ?? [null, null, null],
        }))
        console.log(`[CARNIVAL] response records: ${JSON.stringify(records)}`)

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "records": records,
                "user_party_group_list": partyGroups
            }
        });
    });

    fastify.post("/get_party", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id: number, api_count: number };

        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid request body."
        });

        const viewerIdSession = await getSession(viewerId.toString());
        if (!viewerIdSession) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Invalid viewer id."
        });

        const playerId = resolvePlayerIdSync(viewerIdSession.accountId)!;
        if (playerId === null) return reply.status(500).send({
            "error": "Internal Server Error",
            "message": "No player bound to account."
        });

        const partyGroups = buildCarnivalPartyGroupList(playerId);

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "user_party_group_list": partyGroups
            }
        });
    });
};

export default routes;
