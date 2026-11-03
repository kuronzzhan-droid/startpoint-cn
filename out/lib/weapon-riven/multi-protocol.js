"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRivenCanonical = exports.parseRivenAcknowledgement = exports.canonicalRivenMembers = exports.cloneRivenJson = exports.rivenIdentityKey = exports.rivenInternalIdentity = exports.rivenInteger = exports.rivenIdentifier = exports.RIVEN_MULTI_MAX_ACK_BYTES = exports.RIVEN_MULTI_CAPABILITY = exports.RIVEN_MULTI_SCOPE = void 0;
const client_1 = require("./client");
const constants_1 = require("./constants");
exports.RIVEN_MULTI_SCOPE = "multi-v1";
exports.RIVEN_MULTI_CAPABILITY = "weapon-riven-multi-v1";
exports.RIVEN_MULTI_MAX_ACK_BYTES = 4096;
const ID = /^[A-Za-z0-9_-]{1,96}$/;
function rivenIdentifier(value) {
    if (typeof value !== "string" || !ID.test(value))
        throw new Error("RIVEN_INVALID_IDENTIFIER");
    return value;
}
exports.rivenIdentifier = rivenIdentifier;
function rivenInteger(value, minimum = 0) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
        throw new Error("RIVEN_INVALID_INTEGER");
    return value;
}
exports.rivenInteger = rivenInteger;
function rivenInternalIdentity(value) {
    if (typeof value !== "string" || !/^[\x20-\x7e]{1,256}$/.test(value))
        throw new Error("RIVEN_INVALID_INTERNAL_IDENTITY");
    return value;
}
exports.rivenInternalIdentity = rivenInternalIdentity;
function rivenIdentityKey(identity) {
    if (!identity)
        throw new Error("RIVEN_INVALID_IDENTITY");
    return JSON.stringify([rivenInternalIdentity(identity.ownerEpoch), rivenInternalIdentity(identity.roomInstanceId),
        rivenInteger(identity.sourceLobbyGeneration), rivenInternalIdentity(identity.preparationId)]);
}
exports.rivenIdentityKey = rivenIdentityKey;
function cloneRivenJson(value) { return JSON.parse(JSON.stringify(value)); }
exports.cloneRivenJson = cloneRivenJson;
function option(value) {
    if (!Array.isArray(value))
        throw new Error("RIVEN_INVALID_OPTION");
    if (value.length === 1 && value[0] === 1)
        return null;
    if (value.length === 2 && value[0] === 0 && value[1] !== null)
        return value[1];
    throw new Error("RIVEN_INVALID_OPTION");
}
function slots(party, name) {
    if (!Array.isArray(party === null || party === void 0 ? void 0 : party[name]) || party[name].length !== 3)
        throw new Error("RIVEN_INVALID_SLOTS");
    return party[name];
}
function wireInteger(value) {
    const id = rivenInteger(value, 1);
    if (id > 2147483647)
        throw new Error("RIVEN_INVALID_WIRE_INTEGER");
    return id;
}
function objectId(value, field) { return value === null ? 0 : wireInteger(value === null || value === void 0 ? void 0 : value[field]); }
/** Fixed scalar order; never object iteration, JSON serialization or 32-bit coercion. */
function canonicalRivenMembers(members, resources) {
    var _a, _b;
    if (!Array.isArray(members) || members.length < 1 || members.length > 3)
        throw new Error("RIVEN_INVALID_ROSTER");
    const first = (_a = members.find(member => !(member === null || member === void 0 ? void 0 : member.comId))) === null || _a === void 0 ? void 0 : _a.party;
    if (!first || first.weapon_riven_scope !== exports.RIVEN_MULTI_SCOPE)
        throw new Error("RIVEN_MISSING_CONTEXT");
    const snapshotId = rivenIdentifier(first.weapon_riven_snapshot_id), catalog = rivenIdentifier(first.weapon_riven_catalog);
    const mode = rivenInteger(first.weapon_riven_mode);
    if (mode !== 0 && mode !== 1 || mode === 0 && catalog !== "none" || mode === 1 && catalog === "none")
        throw new Error("RIVEN_INVALID_MODE");
    if (mode && resources && resources.id !== catalog)
        throw new Error("RIVEN_CATALOG_MISMATCH");
    const reason = first.weapon_riven_reason;
    if (typeof reason !== "string" || mode === 1 && reason !== "" || mode === 0 && !ID.test(reason))
        throw new Error("RIVEN_INVALID_REASON");
    const result = ["WFR2C1", catalog, mode, members.length];
    const identities = new Set();
    for (const member of members) {
        const viewerId = rivenInteger(member === null || member === void 0 ? void 0 : member.viewerId, 1), comId = rivenInteger((_b = member === null || member === void 0 ? void 0 : member.comId) !== null && _b !== void 0 ? _b : 0);
        if (comId > 2147483647)
            throw new Error("RIVEN_INVALID_COM_ID");
        const identity = comId ? `C|${comId}` : `V|${viewerId}`;
        if (identities.has(identity))
            throw new Error("RIVEN_DUPLICATE_MEMBER");
        identities.add(identity);
        const party = member.party;
        if (!party || typeof party !== "object")
            throw new Error("RIVEN_INVALID_PARTY");
        if (comId) {
            if (Object.keys(party).some(key => key === "weapon_rivens" || key.startsWith("weapon_riven_")))
                throw new Error("RIVEN_COM_CONTEXT");
        }
        else if (party.weapon_riven_scope !== exports.RIVEN_MULTI_SCOPE || party.weapon_riven_snapshot_id !== snapshotId
            || party.weapon_riven_catalog !== catalog || party.weapon_riven_mode !== mode
            || party.weapon_riven_reason !== reason)
            throw new Error("RIVEN_CONTEXT_MISMATCH");
        const characters = slots(party, "characters"), unisons = slots(party, "unison_characters");
        const equipments = slots(party, "equipments"), souls = slots(party, "abilitySoulIds");
        const rows = comId ? [[1], [1], [1]] : slots(party, "weapon_rivens");
        let count = 0;
        result.push(comId ? "C" : "V", comId || viewerId);
        for (let slot = 0; slot < 3; slot++) {
            const mainId = objectId(option(characters[slot]), "id"), unisonId = objectId(option(unisons[slot]), "id");
            const weaponId = objectId(option(equipments[slot]), "equipmentId");
            const soul = option(souls[slot]), soulId = soul === null ? 0 : wireInteger(soul);
            const row = option(rows[slot]), instance = (0, client_1.isWeaponRivenInstanceId)(soulId);
            if ((comId && (instance || (0, constants_1.isUnknownWeaponRivenItemId)(soulId))) || (!mode && instance))
                throw new Error("RIVEN_DISABLED_INSTANCE");
            if (instance && ++count > 1)
                throw new Error("RIVEN_PARTY_LIMIT");
            if (row === null) {
                if (instance)
                    throw new Error("RIVEN_MISSING_ROW");
                result.push(mainId, unisonId, weaponId, soulId, 0);
                continue;
            }
            if (!mode || comId || !instance || !Array.isArray(row) || ![4, 6, 8, 10].includes(row.length)
                || row[0] !== soulId)
                throw new Error("RIVEN_INVALID_ROW");
            row.forEach(wireInteger);
            if (resources && (!resources.soulKeys.has(soulId) || !resources.weaponIds.has(row[1])
                || weaponId !== 0 && !resources.weaponIds.has(weaponId)))
                throw new Error("RIVEN_MISSING_RESOURCE");
            const keys = new Set();
            for (let i = 2; i < row.length; i += 2) {
                if (row[i + 1] > 100 || keys.has(row[i]) || resources && !resources.soulKeys.has(row[i]))
                    throw new Error("RIVEN_INVALID_AFFIX");
                keys.add(row[i]);
            }
            result.push(mainId, unisonId, weaponId, soulId, row.length, ...row);
        }
    }
    const content = result.join("|");
    if (Buffer.byteLength(`WFR2|A|${snapshotId}|${content}`, "ascii") > exports.RIVEN_MULTI_MAX_ACK_BYTES)
        throw new Error("RIVEN_ACK_LIMIT");
    return content;
}
exports.canonicalRivenMembers = canonicalRivenMembers;
function parseRivenAcknowledgement(value) {
    if (typeof value !== "string" || !value.startsWith("WFR2|"))
        return null;
    if (Buffer.byteLength(value, "utf8") > exports.RIVEN_MULTI_MAX_ACK_BYTES || !/^[\x20-\x7e]+$/.test(value))
        throw new Error("RIVEN_INVALID_ACK");
    const match = /^WFR2\|([AN])\|([A-Za-z0-9_-]{1,96})\|(.+)$/.exec(value);
    if (!match)
        throw new Error("RIVEN_INVALID_ACK");
    if (match[1] === "N" && ID.test(match[3]))
        return { kind: "N", snapshotId: match[2], reason: match[3] };
    if (match[1] !== "A")
        throw new Error("RIVEN_INVALID_ACK");
    validateRivenCanonical(match[3]);
    return { kind: "A", snapshotId: match[2], canonical: match[3] };
}
exports.parseRivenAcknowledgement = parseRivenAcknowledgement;
/** Parse lengths as well as scalar syntax so truncated/extra ACK fields are never accepted. */
function validateRivenCanonical(content) {
    var _a;
    const fields = content.split("|");
    let cursor = 0;
    const number = (maximum = Number.MAX_SAFE_INTEGER) => {
        const raw = fields[cursor++];
        if (!/^(0|[1-9][0-9]*)$/.test(raw !== null && raw !== void 0 ? raw : ""))
            throw new Error("RIVEN_INVALID_CANONICAL");
        const value = rivenInteger(Number(raw));
        if (value > maximum)
            throw new Error("RIVEN_INVALID_CANONICAL");
        return value;
    };
    if (fields[cursor++] !== "WFR2C1" || !ID.test((_a = fields[cursor++]) !== null && _a !== void 0 ? _a : ""))
        throw new Error("RIVEN_INVALID_CANONICAL");
    const mode = number(), count = number(), identities = new Set();
    if (mode > 1 || count < 1 || count > 3 || (mode === 0) !== (fields[1] === "none"))
        throw new Error("RIVEN_INVALID_CANONICAL");
    for (let member = 0; member < count; member++) {
        const kind = fields[cursor++], id = number(), identity = `${kind}|${id}`;
        if (kind !== "V" && kind !== "C" || id < 1 || kind === "C" && id > 2147483647 || identities.has(identity))
            throw new Error("RIVEN_INVALID_CANONICAL");
        identities.add(identity);
        let cards = 0;
        for (let slot = 0; slot < 3; slot++) {
            number(2147483647);
            number(2147483647);
            number(2147483647);
            const soul = number(2147483647), length = number(), instance = (0, client_1.isWeaponRivenInstanceId)(soul);
            if (![0, 4, 6, 8, 10].includes(length) || instance !== (length > 0)
                || instance && (++cards > 1 || mode === 0 || kind === "C")
                || kind === "C" && (0, constants_1.isUnknownWeaponRivenItemId)(soul))
                throw new Error("RIVEN_INVALID_CANONICAL");
            const row = Array.from({ length }, () => number(2147483647));
            if (length && (row[0] !== soul || row.some(value => value < 1)))
                throw new Error("RIVEN_INVALID_CANONICAL");
            const keys = new Set();
            for (let i = 2; i < length; i += 2) {
                if (keys.has(row[i]) || row[i + 1] > 100)
                    throw new Error("RIVEN_INVALID_CANONICAL");
                keys.add(row[i]);
            }
        }
    }
    if (cursor !== fields.length)
        throw new Error("RIVEN_INVALID_CANONICAL");
}
exports.validateRivenCanonical = validateRivenCanonical;
