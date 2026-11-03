"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlayerProfileStatsSync = void 0;
const content_master_1 = require("./content-master");
const character_1 = require("../data/domains/character");
const degree_1 = require("../data/domains/degree");
const MAX_OWNED_CHARACTER_COUNT = Object.keys(content_master_1.serverCharacters).length;
const MAX_OWNED_DEGREE_COUNT = Object.keys(content_master_1.degreeDefinitions).length;
const MAX_OPENED_MANA_BOARD_SECOND_COUNT = Object.values(content_master_1.serverManaNodes).filter(boards => Object.prototype.hasOwnProperty.call(boards, "2")).length;
function getPlayerProfileStatsSync(playerId, characters = (0, character_1.getPlayerCharactersSync)(playerId)) {
    const ownedCharacters = Object.values(characters);
    return {
        maxOpenedManaBoardSecondCount: MAX_OPENED_MANA_BOARD_SECOND_COUNT,
        maxOwnedCharacterCount: MAX_OWNED_CHARACTER_COUNT,
        maxOwnedDegreeCount: MAX_OWNED_DEGREE_COUNT,
        openedManaBoardSecondCount: ownedCharacters.filter(character => (character.bondTokenList.some(token => token.manaBoardIndex === 2 && token.status >= 1))).length,
        ownedCharacterCount: ownedCharacters.length,
        ownedDegreeCount: (0, degree_1.getPlayerDegreeIdsSync)(playerId).length,
    };
}
exports.getPlayerProfileStatsSync = getPlayerProfileStatsSync;
