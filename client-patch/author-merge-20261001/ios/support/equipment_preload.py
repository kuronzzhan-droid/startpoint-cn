"""Handwritten equipment fixture definitions; no historical CLI is executed."""
from __future__ import annotations
import copy
import json
from pathlib import Path
import struct
from equipment_fixture_common import builder, swftags, view, static_methods, body_index, sha
import equipment_core as core


METHODS = {**core.METHODS, 101442: 'authorEquipmentPreloadTiers', 101443: 'authorEquipmentResolveAbilityPaths'}

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def cases():
    rows = []
    def add(name, weapon=True, soul=False, enhanced=False, **changes):
        row = {'name': name, 'weapon': weapon, 'soul': soul, 'enhanced': enhanced,
               'weaponId': 5920001, 'soulId': 5920001,
               'soulKeys': [5921001, 5922001, 5923001],
               'enhancementKeys': [5921001, 5922001, 5923001],
               'missing': [], 'throwTable': False, 'emptyTriggers': False, **changes}
        rows.append(row)
    add('weapon-three-tiers')
    add('weapon-enhancement-three-tiers', enhanced=True)
    add('soul-three-tiers', weapon=False, soul=True)
    add('weapon-and-soul-three-tiers', soul=True)
    add('missing-second-soul-tier', soulKeys=[5921001, 5923001], missing=[5922001])
    add('missing-second-enhancement-tier', enhanced=True, enhancementKeys=[5921001, 5923001], missing=[5922001])
    add('missing-all-tiers', soulKeys=[], missing=[5921001, 5922001, 5923001])
    add('ordinary-weapon', weaponId=5800001)
    add('no-weapon-or-soul', weapon=False)
    add('paradox-weapon-ordinary-soul', soul=True, soulId=5800001)
    add('ordinary-weapon-paradox-soul', soul=True, weaponId=5800001)
    add('tiers-with-empty-triggers', emptyTriggers=True)
    add('table-read-error-propagates', throwTable=True)
    return rows

PROBE = '''package {import flash.display.Sprite;import flash.desktop.NativeApplication;import flash.filesystem.File;import flash.filesystem.FileStream;import flash.filesystem.FileMode;
import cn.mod.AuthorState;import fixture.Trace;import haxe.ds.Option;import pinball.asset.logic.ILogicAssetContainer;import pinball.master.runtime.MasterTable;import pinball.master.runtime.MasterMap;import pinball.master.generated.AbilitySoulTable;import pinball.master.generated.EquipmentEnhancementAbilityTable;
import pinball.common.data.ability.AbilitySoulAbilityLogic;import pinball.common.data.ability.EquipmentAbilityLogic;import pinball.common.data.ability.EquipmentEnhancementAbilityLogic;import pinball.common.data.ability.AbilityPowerValueCalculateMethod;import pinball.common.data.ability.AbilityTrigger;import pinball.common.data.ability.AbilityTriggerTools;
public class Probe extends Sprite {public function Probe(){var linked:Array=[AbilitySoulAbilityLogic,EquipmentAbilityLogic,EquipmentEnhancementAbilityLogic,AbilitySoulTable,EquipmentEnhancementAbilityTable,MasterTable,MasterMap,Option,AbilityTriggerTools,AbilityTrigger];var rows:Array=[];var specs:Array=JSON.parse(CASES) as Array;
for each(var spec:Object in specs){var assets:ILogicAssetContainer=new ILogicAssetContainer();for each(var key:int in spec.soulKeys)assets.soulKeys[String(key)]=true;for each(key in spec.enhancementKeys)assets.enhancementKeys[String(key)]=true;assets.throwTable=spec.throwTable;assets.emptyTriggers=spec.emptyTriggers;
var power:AbilityPowerValueCalculateMethod=new AbilityPowerValueCalculateMethod();var weaponSoul:AbilitySoulAbilityLogic=new AbilitySoulAbilityLogic(41,spec.weaponId,power,true,assets);var orb:AbilitySoulAbilityLogic=new AbilitySoulAbilityLogic(31,spec.soulId,power,false,assets);var enhanced:Option=spec.enhanced?Option.Some(new EquipmentEnhancementAbilityLogic(spec.weaponId,7,12,assets)):Option.None;var ability:EquipmentAbilityLogic=new EquipmentAbilityLogic(weaponSoul,enhanced,assets);
var character:Object={equipment:spec.weapon?Option.Some({getCurrentAbility:function():Object{return ability;}}):Option.None,getAbilitySoulAbility:function():Object{return spec.soul?Option.Some(orb):Option.None;},logicAssets:assets};var paths:Object={tag:"paths"};var owner:Object={tag:"owner"};var permit:Object={tag:"permit"};Trace.reset();var row:Object={name:spec.name,input:spec};try{AuthorState.probePreload(character,paths,owner,permit);row.returned=true;}catch(e:Error){row.returned=false;row.error_id=e.errorID;row.error=e.toString();}row.registrations=Trace.registrations;row.queries=Trace.queries;row.constructors=Trace.events;rows.push(JSON.parse(JSON.stringify(row)));}
var file:File=new File(OUTPUT);var stream:FileStream=new FileStream();stream.open(file,FileMode.WRITE);stream.writeUTFBytes(JSON.stringify({cases:rows,network_used:false,game_executed:false}));stream.close();NativeApplication.nativeApplication.exit();}}}'''

def sources(output, specs):
    result = dict(core.DEPENDENCIES)
    result['fixture/Trace.as'] = result['fixture/Trace.as'].replace('public static var events:Array=[];', 'public static var events:Array=[];public static var registrations:Array=[];').replace('events=[];queries=[];reads=[];', 'events=[];queries=[];reads=[];registrations=[];')
    for cls, part in [('AbilitySoulAbilityLogic', 'soul'), ('EquipmentEnhancementAbilityLogic', 'enhancement')]:
        path = 'pinball/common/data/ability/' + cls + '.as'
        declaration = 'public dynamic class ' + cls + ' {'
        extension = 'public var ownerElement:int=7;public function getTriggers():Array {return logicAssets.emptyTriggers===true?[]:[new AbilityTrigger(id,"' + part + '")];}'
        assert declaration in result[path]
        result[path] = result[path].replace(declaration, declaration + extension, 1)
    path = 'pinball/common/data/ability/EquipmentAbilityLogic.as'
    declaration = 'public dynamic class EquipmentAbilityLogic {'
    extension = 'public var ownerElement:int=7;public function getTriggers():Array {var a:Array=abilitySoulAbility.getTriggers();return enhancementAbility.index==0?a.concat(enhancementAbility.params[0].getTriggers()):a;}'
    assert declaration in result[path]
    result[path] = result[path].replace(declaration, declaration + extension, 1)
    result['pinball/common/data/ability/AbilityTrigger.as'] = 'package pinball.common.data.ability {public class AbilityTrigger {public var id:int;public var part:String;public function AbilityTrigger(id:int,part:String){this.id=id;this.part=part;}}}'
    result['pinball/common/data/ability/AbilityTriggerTools.as'] = 'package pinball.common.data.ability {import fixture.Trace;import pinball.asset.logic.ILogicAssetContainer;public class AbilityTriggerTools {public static function resolvePathCollection(t:Object,p:Object,o:Object,f:Object,e:int,a:ILogicAssetContainer):void {Trace.registrations.push({tierId:t.id,part:t.part,paths:p.tag,owner:o.tag,permit:f.tag,element:e,assets:a.tag});}}}'
    extra = '''public static function authorEquipmentPreloadTiers(c:Object,p:Object,o:Object,f:Object):void{}
public static function authorEquipmentResolveAbilityPaths(c:Object,a:Object,p:Object,o:Object,f:Object):void{}
public static function probePreload(c:Object,p:Object,o:Object,f:Object):void{authorEquipmentPreloadTiers(c,p,o,f);}
'''
    head, tail = core.AUTHOR.rsplit('}}', 1)
    result['cn/mod/AuthorState.as'] = head + extra + '}}' + tail
    result['Probe.as'] = PROBE.replace('OUTPUT', json.dumps(output.as_posix())).replace('CASES', json.dumps(json.dumps(specs)))
    return result

def patch(template, full, variant):
    target = copy.deepcopy(template)
    importer = builder.Importer(view(target), view(full))
    target_methods, original = static_methods(target, 'cn.mod::AuthorState'), static_methods(full, 'cn.mod::AuthorState')
    for name in METHODS.values():
        target_methods[name].name = importer.pool('multinames', original[name].name)
    for name in ('probeMember', 'probeCount', 'probeTier', 'probeRule', 'probePreload'):
        at = body_index(target, target_methods[name].data[2])
        instructions = builder.asm.decode(target.bodies[at][5])
        for ins in instructions:
            if ins.op in builder.MULTINAME_OPS:
                short = target.mn_name(ins.args[0]).rsplit('::', 1)[-1]
                if short in METHODS.values():
                    ins.args[0] = target_methods[short].name
        target.bodies[at][5] = builder.asm.encode(instructions)[0]
    importer.target = view(target)
    expected_edits = {}
    for mid, name in METHODS.items():
        bi, dm = body_index(full, mid), target_methods[name].data[2]
        db = body_index(target, dm)
        imported = importer.body(bi, dm, scope=target.bodies[db][3])
        target.methods[dm] = importer.info(mid)
        target.bodies[db] = imported
        assert view(target).normalized(db) == view(full).normalized(bi)
        edits = []
        if mid == 101442 and variant != 'current-exact' or mid == 101443 and variant == 'all-seven-stores-control':
            replacements = {0xd6: 5, 0xd7: 6} if mid == 101442 else {0xd6: 7, 0xd7: 8}
            instructions = builder.asm.decode(imported[5])
            for i, ins in enumerate(instructions):
                if ins.op in replacements:
                    instructions[i] = builder.asm.Instruction(0x63, [replacements[ins.op]])
                    edits.append(i)
            imported[5] = builder.asm.encode(instructions)[0]
        expected_edits[mid] = edits
        builder.check_body(imported, target)
    core.dependency_signatures(target, full, adapt=True)
    return target, expected_edits

def bind(parsed, full, expected_edits):
    records = []
    methods = static_methods(parsed, 'cn.mod::AuthorState')
    sv, pv = view(full), view(parsed)
    for mid, name in METHODS.items():
        sb = body_index(full, mid)
        dm = methods[name].data[2]
        db = body_index(parsed, dm)
        a, ae = sv.normalized(sb)
        b, be = pv.normalized(db)
        assert len(a) == len(b) and ae == be
        differences = [i for i, pair in enumerate(zip(a, b)) if pair[0] != pair[1]]
        assert differences == expected_edits[mid]
        assert builder.Importer(pv, sv).info(mid) == parsed.methods[dm]
        records.append({'source_method': mid, 'target_method': dm, 'source_body_sha256': sha(full.bodies[sb][5]),
                        'target_body_sha256': sha(parsed.bodies[db][5]), 'instruction_count': len(a), 'differences': differences,
                        'signatures_and_exceptions_exact': True, 'source_scope': full.bodies[sb][3:5], 'fixture_scope': parsed.bodies[db][3:5]})
    return records

def expected_registrations(spec):
    if spec['emptyTriggers']:
        return []
    result = []
    for part in ('weapon', 'soul'):
        if not spec[part]:
            continue
        sid = spec[part + 'Id']
        if not 5920001 <= sid <= 5920999:
            continue
        for n in (1, 2, 3):
            key = sid + 1000 * n
            if key not in spec['soulKeys'] or part == 'weapon' and spec['enhanced'] and key not in spec['enhancementKeys']:
                continue
            result.append((key, 'soul'))
            if part == 'weapon' and spec['enhanced']:
                result.append((key, 'enhancement'))
    return result
