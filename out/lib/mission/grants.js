"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissionRewardGranter = void 0;
const item_1 = require("../../data/domains/item");
const player_1 = require("../../data/domains/player");
const character_1 = require("../character");
const equipment_1 = require("../equipment");
const degree_1 = require("../../data/domains/degree");
const pass_card_1 = require("../../data/domains/pass-card");
const pass_card_2 = require("../pass-card");
const mana_1 = require("../mana");
class MissionRewardGranter {
    constructor(playerId, player) {
        this.playerId = playerId;
        this.player = player;
        this.itemList = {};
        this.degreeList = [];
        this.passCardPoints = {};
        this.characterMap = new Map();
        this.equipmentMap = new Map();
        this.totalManaGained = 0;
        this.freeVmoney = player.freeVmoney;
        this.freeMana = player.freeMana;
        this.expPool = player.expPool;
    }
    grant(rewards, context = {}) {
        for (const reward of rewards) {
            switch (reward.kind) {
                case 0:
                    this.freeVmoney += reward.amount;
                    break;
                case 1:
                    if (reward.itemId !== undefined) {
                        this.itemList[String(reward.itemId)] = (0, item_1.givePlayerItemSync)(this.playerId, reward.itemId, reward.amount);
                    }
                    break;
                case 2:
                    if (reward.equipmentId !== undefined) {
                        const equipment = (0, equipment_1.givePlayerEquipmentSync)(this.playerId, reward.equipmentId, reward.amount);
                        this.equipmentMap.set(reward.equipmentId, equipment);
                    }
                    break;
                case 3:
                    this.freeMana = (0, mana_1.calculateFreeManaGrant)({
                        freeMana: this.freeMana,
                        paidMana: this.player.paidMana,
                    }, reward.amount).freeMana;
                    this.totalManaGained += reward.amount;
                    break;
                case 4:
                    if (reward.characterId === undefined)
                        break;
                    for (let count = 0; count < reward.amount; count++) {
                        const result = (0, character_1.givePlayerCharacterSync)(this.playerId, reward.characterId);
                        if (!result)
                            continue;
                        this.characterMap.set(reward.characterId, result.character);
                        if (result.item) {
                            this.itemList[String(result.item.id)] = result.item.inventoryCount;
                        }
                    }
                    break;
                case 5:
                    this.expPool += reward.amount;
                    break;
                case 6:
                    if (reward.degreeId !== undefined
                        && !this.degreeList.includes(reward.degreeId)
                        && (0, degree_1.givePlayerDegreeSync)(this.playerId, reward.degreeId)) {
                        this.degreeList.push(reward.degreeId);
                    }
                    break;
                case 7:
                    if (context.passCardEventId === undefined) {
                        throw new Error("Pass card point reward is missing its event scope.");
                    }
                    const passCardEvent = (0, pass_card_2.getPassCardEventDefinition)(context.passCardEventId);
                    if (!passCardEvent) {
                        throw new Error(`Pass card event ${context.passCardEventId} is missing.`);
                    }
                    this.passCardPoints[String(context.passCardEventId)] = (0, pass_card_1.addPlayerPassCardPointSync)(this.playerId, context.passCardEventId, reward.amount, passCardEvent.thresholdPoint);
                    break;
            }
        }
    }
    /**
     * Repairs ownership for an old mission stage that was already marked as
     * received before degree ownership was persisted. This intentionally does
     * not change the player's currently equipped title.
     */
    grantDegreeOwnershipOnly(degreeId) {
        if (!Number.isInteger(degreeId) || degreeId <= 0)
            return;
        if (this.degreeList.includes(degreeId))
            return;
        if ((0, degree_1.givePlayerDegreeSync)(this.playerId, degreeId)) {
            this.degreeList.push(degreeId);
        }
    }
    persistPlayer() {
        var _a;
        if (!this.hasPlayerChanges())
            return;
        (0, player_1.updatePlayerSync)({
            id: this.playerId,
            freeVmoney: this.freeVmoney,
            freeMana: this.freeMana,
            expPool: this.expPool,
            totalManaObtained: ((_a = this.player.totalManaObtained) !== null && _a !== void 0 ? _a : 0) + this.totalManaGained,
        });
    }
    hasPlayerChanges() {
        return this.freeVmoney !== this.player.freeVmoney
            || this.freeMana !== this.player.freeMana
            || this.expPool !== this.player.expPool;
    }
    getUserInfo() {
        return {
            free_vmoney: this.freeVmoney,
            free_mana: this.freeMana,
            exp_pool: this.expPool,
        };
    }
    get characterList() {
        return [...this.characterMap.values()];
    }
    get equipmentList() {
        return [...this.equipmentMap.values()];
    }
}
exports.MissionRewardGranter = MissionRewardGranter;
