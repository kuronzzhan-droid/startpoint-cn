"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const carnivalEvent_1 = require("../../data/domains/carnivalEvent");
const party_1 = require("../../data/domains/party");
const session_1 = require("../../data/domains/session");
const activeAccount_1 = require("../../data/activeAccount");
const player_1 = require("../../data/domains/player");
const utils_1 = require("../../data/utils");
const utils_2 = require("../../utils");
const types_1 = require("../../data/types");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
// The Carnival party selector is a fixed-width three-tab view.  Returning the
// generic twelve party groups compresses the labels until the tab decoration
// overlaps "SET" and makes groups 10-12 wrap onto two lines.
const CARNIVAL_PARTY_GROUP_COUNT = 3;
const CARNIVAL_RECORDED_PARTY_SLOT_COUNT = 3;
function sanitizeCarnivalRecordedPartySlots(characterIds) {
    const slots = (characterIds !== null && characterIds !== void 0 ? characterIds : []).slice(0, CARNIVAL_RECORDED_PARTY_SLOT_COUNT);
    while (slots.length < CARNIVAL_RECORDED_PARTY_SLOT_COUNT)
        slots.push(null);
    return slots.map(characterId => Number.isInteger(characterId) && characterId > 0
        ? characterId
        : null);
}
function buildCarnivalPartyGroupList(playerId) {
    // The client saves Haniwa Carnival parties with category 2.  Reading the
    // generic event category (4) returned a different default pool on every
    // visit, even though /party/edit had correctly persisted the changes.
    const carnivalCategory = types_1.PartyCategory.CARNIVAL;
    let groups = (0, party_1.getPlayerPartyGroupListSync)(playerId, carnivalCategory);
    // /party/edit creates only the slots a player has touched.  Complete the
    // official 3x10 Carnival pool without overwriting saved compositions.
    // Extra groups from the earlier twelve-group bug remain in the database;
    // they are deliberately ignored here instead of being deleted.
    const defaults = (0, player_1.getDefaultPlayerPartyGroupsSync)(carnivalCategory);
    const missingGroups = {};
    let insertedMissingSlots = false;
    for (const [groupId, defaultGroup] of Object.entries(defaults)) {
        if (Number(groupId) > CARNIVAL_PARTY_GROUP_COUNT)
            continue;
        const existingGroup = groups[groupId];
        if (!existingGroup) {
            missingGroups[groupId] = defaultGroup;
            continue;
        }
        for (const [slot, defaultParty] of Object.entries(defaultGroup.list)) {
            if (existingGroup.list[slot])
                continue;
            insertedMissingSlots = true;
        }
    }
    if (insertedMissingSlots || Object.keys(missingGroups).length > 0) {
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "player", playerId, operation: "carnival_party_defaults",
        }, () => {
            for (const [slot, defaultParty] of Object.entries(defaults)) {
                if (Number(slot) > CARNIVAL_PARTY_GROUP_COUNT)
                    continue;
                const existingGroup = groups[slot];
                if (!existingGroup)
                    continue;
                for (const [partySlot, party] of Object.entries(defaultParty.list)) {
                    if (existingGroup.list[partySlot])
                        continue;
                    (0, party_1.updatePlayerPartySync)(playerId, Number(partySlot), party, Number(slot));
                }
            }
            if (Object.keys(missingGroups).length > 0) {
                (0, party_1.insertPlayerPartyGroupListSync)(playerId, missingGroups);
            }
        });
    }
    if (insertedMissingSlots || Object.keys(missingGroups).length > 0) {
        groups = (0, party_1.getPlayerPartyGroupListSync)(playerId, carnivalCategory);
    }
    const serialized = (0, utils_1.serializePartyGroupList)(groups);
    // Convert to array format the client expects
    const result = [];
    for (const [groupId, group] of Object.entries(serialized)) {
        const parsedGroupId = Number(groupId);
        if (parsedGroupId < 1 || parsedGroupId > CARNIVAL_PARTY_GROUP_COUNT)
            continue;
        const partyList = [];
        const list = group.list || {};
        for (const [partyId, party] of Object.entries(list)) {
            const p = party;
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
            "party_group_color_id": group.color_id || 0,
            "party_list": partyList
        });
    }
    return result;
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/index", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player bound to account."
            });
        const partyGroups = buildCarnivalPartyGroupList(playerId);
        // Build records from DB
        const eventId = body.event_id;
        // Normalize historical 1..9 difficulty rows into the three displayed
        // folders for every elemental Haniwa Carnival, not only event 250606.
        (0, carnivalEvent_1.migrateCarnivalEventFolderRecordsSync)(eventId);
        const dbRecords = (0, carnivalEvent_1.getPlayerCarnivalEventRecordsSync)(playerId, eventId);
        const records = dbRecords.map(r => ({
            folder_id: r.folderId,
            best_score: r.bestScore,
            // This screen represents the retained per-folder record.  Sending
            // the most recent lower attempt here makes the graph look as if a
            // high score was overwritten.
            previous_score: r.bestScore,
            previous_character_ids: sanitizeCarnivalRecordedPartySlots(r.previousCharacterIds),
            previous_unison_character_ids: sanitizeCarnivalRecordedPartySlots(r.previousUnisonCharacterIds),
        }));
        console.log(`[CARNIVAL] response records: ${JSON.stringify(records)}`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_2.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "records": records,
                "user_party_group_list": partyGroups
            }
        });
    }));
    fastify.post("/get_party", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No player bound to account."
            });
        const partyGroups = buildCarnivalPartyGroupList(playerId);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_2.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "user_party_group_list": partyGroups
            }
        });
    }));
});
exports.default = routes;
