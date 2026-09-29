import assert from "node:assert/strict"
import { test } from "node:test"
import { PlayerCharacter } from "../data/types"
import { wikiPublicId } from "../lib/wiki-team-code-client"
import { nativeBattleParty, ownedTeam, resolvePublicTeam, TeamAssets, TeamInventory } from "../lib/wiki-team-code-inventory"

const character = (exp: number): PlayerCharacter => ({entryCount:1,evolutionLevel:1,overLimitStep:4,protection:false,
    joinTime:new Date(0),updateTime:new Date(0),exp,stack:0,manaBoardIndex:1,bondTokenList:[]})
const assets: TeamAssets = {characters:new Map([1,2,3,4].map((id)=>[wikiPublicId("c",id),id])),
    equipment:new Map([5001,5002].map((id)=>[wikiPublicId("w",id),id])),souls:new Map([[5001,6001]]),maxLevels:{5001:5,5002:1}}
function inventory(): TeamInventory {
    return {characters:{1:character(123),2:character(456)},equipment:{5001:{level:5,enhancementLevel:120,protection:false,stack:0}},
        items:{6001:2},nodes:(id)=>[id*100+1]}
}
const team = () => ({main:[1,2,3],unison:[4,null,null],weapon:[5001,5001,5002],soul:[6001,6001,6001]})
test("public equipment identities resolve through the server soul mapping, never raw supplied IDs",()=>{
    const resolved=resolvePublicTeam({main:[1,2,3].map((id)=>wikiPublicId("c",id)),unison:["","",""],
        weapon:[wikiPublicId("w",5001),"",""],soul:[wikiPublicId("w",5001),"",""]},assets)
    assert.equal(resolved.soul[0],6001)
    assert.throws(()=>resolvePublicTeam({main:["c000000000000","",""],unison:["","",""],weapon:["","",""],soul:["","",""]},assets))
})
test("missing ownership is left empty and equipment stack zero still means one owned item",()=>{
    const inv=inventory(), snapshot=JSON.stringify(inv)
    assert.deepEqual(ownedTeam(team(),inv,assets),{main:[1,2,null],unison:[null,null,null],weapon:[5001,null,null],soul:[6001,6001,null]})
    assert.equal(JSON.stringify(inv),snapshot)
    inv.equipment[5001].stack=1; assert.deepEqual(ownedTeam(team(),inv,assets).weapon,[5001,5001,null])
})
test("final edit projection drops duplicate characters, invalid IDs and non-soul items",()=>{
    const inv=inventory(); inv.items[42]=999
    assert.deepEqual(ownedTeam({main:[1,1,-1],unison:[2,1,null],weapon:[999,null,5001],soul:[42,6001,6001]},inv,assets),
        {main:[1,null,null],unison:[2,null,null],weapon:[null,null,5001],soul:[null,6001,6001]})
})
test("native response uses only the requesting player's levels, nodes, EX and illustrations",()=>{
    const inv=inventory(); inv.characters[1].exBoost={statusId:7,abilityIdList:[8,9]}; inv.characters[1].illustrationSettings=[1]
    const output=nativeBattleParty(team(),inv,assets)
    assert.deepEqual(output.characters[0],{id:1,evolution_level:1,exp:123,over_limit_step:4,mana_node_ids:[101],
        illustration_settings:[1],ex_boost:{status_id:7,ability_id_list:[8,9]}})
    assert.deepEqual(output.equipments,[{equipment_id:5001,level:5},null,null])
    assert.deepEqual(output.ability_soul_ids,[6001,6001,null])
    assert.equal(output.characters[2],null)
})
