"""Handwritten equipment fixture definitions; no historical CLI is executed."""
from __future__ import annotations
import copy
import json
from pathlib import Path
import struct
from equipment_fixture_common import builder, swftags, view, static_methods, body_index, sha
SDK = JAVA = None
OUT = Path(".")  # Set by the caller; validation captures this writer.


METHODS = {101437: 'authorEquipmentIsCursedSoul', 101438: 'authorEquipmentIsDecaySoul',
           101439: 'authorEquipmentCount', 101440: 'authorEquipmentTier', 101441: 'authorEquipmentRule'}

DEPENDENCIES = {
'fixture/Trace.as': '''package fixture {public class Trace {
public static var events:Array=[];public static var queries:Array=[];public static var reads:Array=[];
public static function reset():void {events=[];queries=[];reads=[];}
}}''',
'pinball/common/data/ability/AbilityPowerValueCalculateMethod.as': '''package pinball.common.data.ability {public dynamic class AbilityPowerValueCalculateMethod {
public var currentLevel:int=80;public var maxLevel:int=100;public var tag:String="power-original";
}}''',
'pinball/asset/logic/ILogicAssetContainer.as': '''package pinball.asset.logic {
import pinball.master.runtime.MasterTable;import pinball.master.generated.AbilitySoulTable;import fixture.Trace;
public dynamic class ILogicAssetContainer {public namespace contract="pinball.asset.logic:ILogicAssetContainer";public var soulKeys:Object={};public var enhancementKeys:Object={};public var throwTable:Boolean=false;public var tag:String="assets-original";
contract function getMasterTable(table:Class):MasterTable {var name:String=table===AbilitySoulTable?"soul":"enhancement";Trace.queries.push({table:name});if(throwTable)throw new Error("fixture table failure");return new MasterTable(name=="soul"?soulKeys:enhancementKeys,name);}
}}''',
'pinball/master/runtime/MasterTable.as': '''package pinball.master.runtime {public class MasterTable {private var data:MasterMap;public function MasterTable(keys:Object,name:String){data=new MasterMap();data.keys=keys;data.tableName=name;}public function get_data():MasterMap{return data;}}}''',
'pinball/master/runtime/MasterMap.as': '''package pinball.master.runtime {import fixture.Trace;
public dynamic class MasterMap {public namespace contract="pinball.master.runtime:MasterMap";public var keys:Object={};public var tableName:String;public function MasterMap(){}
contract function exists(key:Object):Boolean {var ok:Boolean=keys[String(key)]===true;Trace.queries.push({table:tableName,key:int(key),exists:ok});return ok;}
}}''',
'pinball/master/generated/AbilitySoulTable.as': '''package pinball.master.generated {public class AbilitySoulTable {}}''',
'pinball/master/generated/EquipmentEnhancementAbilityTable.as': '''package pinball.master.generated {public class EquipmentEnhancementAbilityTable {}}''',
'haxe/ds/Option.as': '''package haxe.ds {public class Option {public var index:int;public var params:Array;public var tag:String;
public function Option(tag:String,index:int,params:Array){this.tag=tag;this.index=index;this.params=params;}
public static function Some(v:Object):Option{return new Option("Some",0,[v]);}public static var None:Option=new Option("None",1,[]);
}}''',
'pinball/common/data/ability/AbilitySoulAbilityLogic.as': '''package pinball.common.data.ability {import pinball.asset.logic.ILogicAssetContainer;import fixture.Trace;
public dynamic class AbilitySoulAbilityLogic {public var number:int;public var id:int;public var power:Object;public var isEquipment:Boolean;public var logicAssets:ILogicAssetContainer;
public function AbilitySoulAbilityLogic(number:int=0,id:int=0,calculate:AbilityPowerValueCalculateMethod=null,isEquipment:Boolean=false,assets:ILogicAssetContainer=null){this.number=number;this.id=id;this.power={calculateMethod:calculate};this.isEquipment=isEquipment;this.logicAssets=assets;Trace.events.push({kind:"soul",number:number,id:id,calculateTag:calculate.tag,currentLevel:calculate.currentLevel,maxLevel:calculate.maxLevel,isEquipment:isEquipment,assetsTag:assets.tag});}
}}''',
'pinball/common/data/ability/EquipmentEnhancementAbilityLogic.as': '''package pinball.common.data.ability {import pinball.asset.logic.ILogicAssetContainer;import fixture.Trace;
public dynamic class EquipmentEnhancementAbilityLogic {public var id:int;public var currentLevel:int;public var maxLevel:int;public var logicAssets:ILogicAssetContainer;
public function EquipmentEnhancementAbilityLogic(id:int=0,currentLevel:int=0,maxLevel:int=0,assets:ILogicAssetContainer=null){this.id=id;this.currentLevel=currentLevel;this.maxLevel=maxLevel;this.logicAssets=assets;}
public static function createForEquipment(id:int,currentLevel:int,maxLevel:int,assets:ILogicAssetContainer):EquipmentEnhancementAbilityLogic {Trace.events.push({kind:"enhancement",id:id,currentLevel:currentLevel,maxLevel:maxLevel,assetsTag:assets.tag});return new EquipmentEnhancementAbilityLogic(id,currentLevel,maxLevel,assets);}
}}''',
'pinball/common/data/ability/EquipmentAbilityLogic.as': '''package pinball.common.data.ability {import pinball.asset.logic.ILogicAssetContainer;import haxe.ds.Option;import fixture.Trace;
public dynamic class EquipmentAbilityLogic {public var abilitySoulAbility:AbilitySoulAbilityLogic;public var enhancementAbility:Option;public var logicAssets:ILogicAssetContainer;
public function EquipmentAbilityLogic(soul:AbilitySoulAbilityLogic=null,enhancement:Option=null,assets:ILogicAssetContainer=null){abilitySoulAbility=soul;enhancementAbility=enhancement;logicAssets=assets;Trace.events.push({kind:"equipment",soulId:soul.id,enhancementIndex:enhancement.index,enhancementId:enhancement.index==0?enhancement.params[0].id:null,assetsTag:assets.tag});}
}}''',
}

AUTHOR = '''package cn.mod {public class AuthorState {
public static function authorEquipmentIsCursedSoul(c:Object,id:int):Boolean{return false;}
public static function authorEquipmentIsDecaySoul(c:Object,id:int):Boolean{return false;}
public static function authorEquipmentCount(c:Object,p:Object,curseOnly:Boolean):int{return -100;}
public static function authorEquipmentTier(c:Object,p:Object,s:Object,n:int):Object{return null;}
public static function authorEquipmentRule(c:Object,p:Object,s:Object,party:Object):Object{return null;}
public static function probeMember(c:Object,id:int):Object{return {cursed:authorEquipmentIsCursedSoul(c,id),decay:authorEquipmentIsDecaySoul(c,id)};}
public static function probeCount(c:Object,p:Object,f:Boolean):int{return authorEquipmentCount(c,p,f);}
public static function probeTier(c:Object,p:Object,s:Object,n:int):Object{return authorEquipmentTier(c,p,s,n);}
public static function probeRule(c:Object,p:Object,s:Object,party:Object):Object{return authorEquipmentRule(c,p,s,party);}
}}'''

PROBE = '''package {
import flash.display.Sprite;import flash.desktop.NativeApplication;import flash.filesystem.File;import flash.filesystem.FileStream;import flash.filesystem.FileMode;
import cn.mod.AuthorState;import fixture.Trace;import haxe.ds.Option;import pinball.asset.logic.ILogicAssetContainer;import pinball.master.runtime.MasterTable;import pinball.master.runtime.MasterMap;import pinball.master.generated.AbilitySoulTable;import pinball.master.generated.EquipmentEnhancementAbilityTable;
import pinball.common.data.ability.AbilitySoulAbilityLogic;import pinball.common.data.ability.EquipmentAbilityLogic;import pinball.common.data.ability.EquipmentEnhancementAbilityLogic;import pinball.common.data.ability.AbilityPowerValueCalculateMethod;
public class Probe extends Sprite {public function Probe(){var linked:Array=[AbilitySoulAbilityLogic,EquipmentAbilityLogic,EquipmentEnhancementAbilityLogic,AbilitySoulTable,EquipmentEnhancementAbilityTable,MasterTable,MasterMap,Option];var cases:Array=JSON.parse(CASES) as Array;var rows:Array=[];
function option(id:Object,slot:String):Object {if(id===null)return {index:1,params:[]};return {index:0,params:[{get_abilitySoulId:function():int{Trace.reads.push({slot:slot,id:int(id)});return int(id);}}]};}
function summary(value:Object,original:Object):Object {if(value===null)return {kind:"off",same:false};var soul:Object=value is EquipmentAbilityLogic?value.abilitySoulAbility:value;var enhanced:Object=value is EquipmentAbilityLogic?value.enhancementAbility:null;return {kind:value is EquipmentAbilityLogic?"weapon":"soul",same:value===original,soulId:soul.id,number:soul.number,isEquipment:soul.isEquipment,calculateTag:soul.power.calculateMethod.tag,calculateSame:soul.power.calculateMethod===power,assetsSame:soul.logicAssets===assets&&value.logicAssets===assets,currentLevel:soul.power.calculateMethod.currentLevel,maxLevel:soul.power.calculateMethod.maxLevel,enhancementId:enhanced&&enhanced.index==0?enhanced.params[0].id:null,enhancementCurrentLevel:enhanced&&enhanced.index==0?enhanced.params[0].currentLevel:null,enhancementMaxLevel:enhanced&&enhanced.index==0?enhanced.params[0].maxLevel:null,enhancementAssetsSame:enhanced&&enhanced.index==0?enhanced.params[0].logicAssets===assets:null};}
for each(var spec:Object in cases){var gets:Array=[];var assets:ILogicAssetContainer=new ILogicAssetContainer();for each(var key:int in spec.soulKeys)assets.soulKeys[String(key)]=true;for each(key in spec.enhancementKeys)assets.enhancementKeys[String(key)]=true;assets.throwTable=spec.throwTable===true;
var power:AbilityPowerValueCalculateMethod=new AbilityPowerValueCalculateMethod();var soul:AbilitySoulAbilityLogic=new AbilitySoulAbilityLogic(spec.mode=="soul"?31:41,int(spec.id),power,spec.mode!="soul",assets);var enhancement:Option=spec.enhanced?Option.Some(new EquipmentEnhancementAbilityLogic(int(spec.enhancementId),7,12,assets)):Option.None;
var peek:Object=spec.mode=="soul"?soul:new EquipmentAbilityLogic(soul,enhancement,assets);
var party:Object={getBattleEquipment:function(i:int):Object{gets.push("equipment:"+i);if(spec.throwGetter===true)throw new Error("fixture party failure");return option(spec.equipment[i],"equipment:"+i);},getAbilitySoul:function(i:int):Object{gets.push("soul:"+i);return option(spec.souls[i],"soul:"+i);}};
Trace.reset();var row:Object={name:spec.name,category:spec.category,operation:spec.operation,input:spec};try{if(spec.operation=="membership")row.result=AuthorState.probeMember({},int(spec.id));else if(spec.operation=="count")row.result=AuthorState.probeCount({},spec.nullParty?null:party,Boolean(spec.filter));else if(spec.operation=="tier")row.result=summary(AuthorState.probeTier({},peek,spec.nullSoul?null:soul,int(spec.n)),peek);else row.result=summary(AuthorState.probeRule({},peek,soul,spec.nullParty?null:party),peek);row.returned=true;}catch(e:Error){row.returned=false;row.error_id=e.errorID;row.error=e.toString();}
row.getters=gets;row.idReads=Trace.reads;row.tableQueries=Trace.queries;row.constructors=Trace.events;rows.push(JSON.parse(JSON.stringify(row)));}
var file:File=new File(OUTPUT);var stream:FileStream=new FileStream();stream.open(file,FileMode.WRITE);stream.writeUTFBytes(JSON.stringify({cases:rows,network_used:false,game_executed:false}));stream.close();NativeApplication.nativeApplication.exit();}}}'''

def sources(output_path: Path, cases: list[dict]) -> dict[str, str]:
    return {**DEPENDENCIES, 'cn/mod/AuthorState.as': AUTHOR,
            'Probe.as': PROBE.replace('OUTPUT', json.dumps(output_path.as_posix()))
                            .replace('CASES', json.dumps(json.dumps(cases)))}

def make_cases():
    cases = []
    def add(name, category, operation='rule', **kwargs):
        row = {'name': name, 'category': category, 'operation': operation, 'mode': 'weapon',
               'id': 5920001, 'enhanced': True, 'enhancementId': 5900207,
               'soulKeys': [5921001, 5922001, 5923001],
               'enhancementKeys': [5901207, 5902207, 5903207],
               'equipment': [None]*3, 'souls': [None]*3, **kwargs}
        cases.append(row)
        return row
    def slots(subject, n, mode):
        eq, so = [None]*3, [None]*3
        subject_at = ('soul', 0) if mode == 'soul' else ('equipment', 0)
        (so if mode == 'soul' else eq)[0] = subject
        others = [(kind, i) for i in range(3) for kind in ('equipment','soul') if (kind,i)!=subject_at]
        for kind, i in others[:n]:
            (eq if kind=='equipment' else so)[i] = 5800001
        return {'equipment': eq, 'souls': so}
    for sid in [0, 5910100,5910101,5910199,5910200,5920000,5920001,5920999,5921000]:
        add('membership-'+str(sid), 'membership', 'membership', id=sid)
    for mode, enhanced in [('weapon', True), ('weapon',False), ('soul',False)]:
        for n in range(6):
            for sid, category in [(5920001,'paradox'),(5800001,'ordinary')]:
                add(f'{category}-{mode}-enh{int(enhanced)}-n{n}',category,mode=mode,enhanced=enhanced,id=sid,n=n,**slots(sid,n,mode))
        for n in (1,2,3):
            add(f'missing-soul-{mode}-enh{int(enhanced)}-n{n}','missing-soul',mode=mode,enhanced=enhanced,n=n,soulKeys=[],**slots(5920001,n,mode))
            if enhanced:
                add(f'missing-enhancement-n{n}','missing-enhancement',mode=mode,enhanced=True,n=n,enhancementKeys=[],**slots(5920001,n,mode))
    for mode in ('weapon','soul'):
        for total in range(1,7):
            p=slots(5910101,total-1,mode)
            add(f'cursed-single-{mode}-total{total}','cursed-single',id=5910101,mode=mode,enhanced=mode=='weapon',total=total,**p)
        for cursed in range(2,7):
            p=slots(5910101,cursed-1,mode)
            for arr in p.values():
                for i, sid in enumerate(arr):
                    if sid is not None:arr[i]=5910101
            add(f'cursed-multiple-{mode}-count{cursed}','cursed-multiple',id=5910101,mode=mode,enhanced=mode=='weapon',cursed=cursed,**p)
    count_patterns=[('empty',[None,None,None],[None,None,None],0,0),('ordinary',[5800001,None,None],[None,None,None],1,0),('curse',[5910101,None,None],[None,None,None],1,1),('mixed',[5800001,5910101,5800002],[5910199,None,5910101],5,3),('full',[5800001,5910101,5920001],[5910199,5800002,5910101],6,3),('last-main-sparse',[None,None,5910199],[None,None,5800001],2,1)]
    for name,eq,so,total,cursed in count_patterns:
        for flag in (False,True):
            add('count-'+name+'-filter'+str(flag).lower(),'count','count',equipment=eq,souls=so,filter=flag,total=total,cursed=cursed)
    add('rule-table-exception','failure',n=1,throwTable=True,**slots(5920001,1,'weapon'))
    add('rule-party-exception','failure',throwGetter=True,**slots(5920001,1,'weapon'))
    add('count-null-party','failure','count',nullParty=True,filter=True)
    add('tier-null-soul','failure','tier',nullSoul=True,n=1)
    add('ordinary-does-not-consult-null-party','ordinary',id=5800001,nullParty=True,n=0)
    return cases

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def parse_swf(path):
    _,version,_,body=swftags.load_swf(str(path))
    tag,=[r for r in swftags.iter_tags(body) if r[0]==82]
    _,start,header,size=tag
    payload=body[start+header:start+header+size];end=payload.index(b'\0',4)
    return version,body,tag,payload,end,builder.abcfmt.ABC(payload[end+1:])

DEPENDENCY_SIGNATURES = [
    ('pinball.common.data.ability::AbilitySoulAbilityLogic', 'constructor', 7840),
    ('pinball.common.data.ability::EquipmentAbilityLogic', 'constructor', 8026),
    ('pinball.common.data.ability::EquipmentEnhancementAbilityLogic', 'constructor', 8059),
    ('pinball.common.data.ability::EquipmentEnhancementAbilityLogic', 'createForEquipment', 8089),
    ('pinball.asset.logic::ILogicAssetContainer', 'getMasterTable', 5784),
    ('pinball.master.runtime::MasterMap', 'exists', 27884),
    ('haxe.ds::Option', 'constructor', 3740),
    ('haxe.ds::Option', 'Some', 3743),
]

def dependency_signatures(target, source, adapt=False):
    importer=builder.Importer(view(target),view(source));receipts=[]
    for owner,name,mid in DEPENDENCY_SIGNATURES:
        index,=[i for i,r in enumerate(target.instances) if target.mn_name(r[0])==owner]
        row=target.instances[index]
        trait=None
        if name=='constructor':dm=row[5]
        else:
            trait,=[t for t in [*row[6],*target.classes[index][1]] if t.data[0]=='method' and target.mn_name(t.name).rsplit('::',1)[-1]==name]
            dm=trait.data[2]
        expected=importer.info(mid)
        # The compiler writes parameter names and different optional null tags.
        # Adapt only substitute metadata, preserving recording implementation.
        if adapt:target.methods[dm]=expected
        assert target.methods[dm]==expected,(owner,name)
        if trait is not None:
            source_trait,=[t for r in source.instances for t in r[6] if t.data[0]=='method' and t.data[2]==mid]+[t for r in source.classes for t in r[1] if t.data[0]=='method' and t.data[2]==mid]
            assert view(target).mn(trait.name)==view(source).mn(source_trait.name)
        receipts.append({'owner':owner,'method':name,'source_method':mid,'substitute_method':dm,'signature_flags_defaults_names_exact_after_pool_resolution':True,'substitute_metadata_adapted':True,'body_is_recording_substitute':True})
    return receipts

def patch_template(template, full, variant):
    target=copy.deepcopy(template);source_view=view(full)
    dependency_signatures(target,full,adapt=True)
    importer=builder.Importer(view(target),source_view)
    methods=static_methods(target,'cn.mod::AuthorState');original=static_methods(full,'cn.mod::AuthorState')
    for name in METHODS.values():methods[name].name=importer.pool('multinames',original[name].name)
    for adapter in ('probeMember','probeCount','probeTier','probeRule'):
        bi=body_index(target,methods[adapter].data[2]);instructions=builder.asm.decode(target.bodies[bi][5])
        for ins in instructions:
            if ins.op in builder.MULTINAME_OPS:
                name=target.mn_name(ins.args[0]).rsplit('::',1)[-1]
                if name in METHODS.values():ins.args[0]=methods[name].name
        target.bodies[bi][5]=builder.asm.encode(instructions)[0]
    importer.target=view(target)
    for mid,name in METHODS.items():
        source_bi=body_index(full,mid);dest_mid=methods[name].data[2];dest_bi=body_index(target,dest_mid)
        imported=importer.body(source_bi,dest_mid,scope=target.bodies[dest_bi][3])
        target.methods[dest_mid]=importer.info(mid);target.bodies[dest_bi]=imported
        assert view(target).normalized(dest_bi)==source_view.normalized(source_bi)
        if variant=='single-store-control' and mid==101439:
            instructions=builder.asm.decode(imported[5]);assert instructions[3].op==0xd7
            instructions[3]=builder.asm.Instruction(0x63,[4]);imported[5]=builder.asm.encode(instructions)[0]
        builder.check_body(imported,target)
    return target

def bind_methods(parsed,full,variant):
    receipts=[];pv,sv=view(parsed),view(full)
    methods=static_methods(parsed,'cn.mod::AuthorState')
    for mid,name in METHODS.items():
        sm=body_index(full,mid);dm=methods[name].data[2];db=body_index(parsed,dm)
        expected_info=builder.Importer(pv,sv).info(mid)
        assert expected_info==parsed.methods[dm]
        sr,se=sv.normalized(sm);dr,de=pv.normalized(db)
        assert len(sr)==len(dr) and se==de
        differences=[i for i,(a,b) in enumerate(zip(sr,dr)) if a!=b]
        assert differences==([3] if variant=='single-store-control' and mid==101439 else [])
        assert not full.bodies[sm][7] and not parsed.bodies[db][7]
        assert parsed.bodies[db][1:3]==full.bodies[sm][1:3]
        receipts.append({'source_method':mid,'name':name,'target_method':dm,'source_body_sha256':sha(full.bodies[sm][5]),'saved_target_body_sha256':sha(parsed.bodies[db][5]),'instruction_count':len(sr),'differences':differences,'signatures_exact_after_pool_resolution':True,'exceptions_exact_after_pool_resolution':True,'branches_exact_after_pool_resolution':True,'activation_traits_equal':True,'source_scope':full.bodies[sm][3:5],'fixture_scope':parsed.bodies[db][3:5],'fixture_scope_adapter':'initial scope 1 to 0, no lexical getscopeobject/newfunction','signature':{'return':sv.mn(full.methods[mid][0]),'parameters':[sv.mn(i) for i in full.methods[mid][1]],'flags_options_names':full.methods[mid][3:]}})
    return receipts

def validate(observations):
    checks=[]
    for variant,observed in observations.items():
        for row in observed['cases']:
            s=row['input'];cat=s['category'];ok=True
            if cat=='failure':
                ok=not row['returned']
                expected_error={'rule-table-exception':(0,'fixture table failure'),'rule-party-exception':(0,'fixture party failure'),'count-null-party':(1009,'#1009'),'tier-null-soul':(1009,'#1009')}[s['name']]
                ok=ok and row.get('error_id')==expected_error[0] and expected_error[1] in row.get('error','')
            elif not row['returned']:ok=False
            elif cat=='membership':
                ok=row['result']=={'cursed':5910101<=s['id']<=5910199,'decay':5920001<=s['id']<=5920999}
            elif cat=='count':
                expected=s['cursed'] if s['filter'] and variant=='single-store-control' else s['total']
                ok=row['result']==expected
                ok=ok and len(row['idReads'])==(s['total'] if s['filter'] and variant=='single-store-control' else 0)
            else:
                result=row['result'];expected_kind='soul' if s['mode']=='soul' else 'weapon'
                if cat in ('ordinary','missing-soul','missing-enhancement'):
                    ok=result['same']
                    if cat=='ordinary':ok=ok and not row['getters'] and not row['constructors'] and not row['tableQueries']
                    if cat=='missing-soul':ok=ok and not row['constructors']
                    if cat=='missing-enhancement':ok=ok and [x['kind'] for x in row['constructors']]==['soul']
                elif cat=='paradox':
                    n=s['n']
                    if n>=4:ok=result['kind']=='off'
                    elif n==0:ok=result['same']
                    else:
                        ok=(not result['same'] and result['kind']==expected_kind and result['soulId']==5920001+1000*n and result['number']==(31 if s['mode']=='soul' else 41) and result['calculateTag']=='power-original' and result['currentLevel']==80 and result['maxLevel']==100 and result['isEquipment']==(s['mode']!='soul') and result['calculateSame'] and result['assetsSame'])
                        if s['enhanced']:ok=ok and result['enhancementId']==5900207+1000*n and result['enhancementCurrentLevel']==7 and result['enhancementMaxLevel']==12 and result['enhancementAssetsSame']
                        else:ok=ok and result['enhancementId'] is None
                        expected_constructors=['soul']+([] if s['mode']=='soul' else ['enhancement','equipment'] if s['enhanced'] else ['equipment'])
                        ok=ok and [x['kind'] for x in row['constructors']]==expected_constructors
                elif cat=='cursed-single':ok=result['same'] if variant=='single-store-control' or s['total']==1 else result['kind']=='off'
                elif cat=='cursed-multiple':ok=result['kind']=='off'
                else:raise AssertionError(cat)
            checks.append({'variant':variant,'case':s['name'],'pass':bool(ok)})
    failures=[r for r in checks if not r['pass']]
    save(OUT/'checks.json',{'checks':checks,'failures':failures})
    assert not failures,failures
    return {'checks':len(checks),'passed':len(checks),'failed':0}

def design_matrix(observations):
    control={r['name']:r for r in observations['single-store-control']['cases']}
    rows=[]
    for current in observations['current-exact']['cases']:
        spec=current['input'];reference=control[current['name']]
        # Control correctness is asserted against explicit design expectations
        # in validate(). Comparing here presents every current/control result.
        comparable=lambda r:{k:r[k] for k in ('returned','result','error_id','error') if k in r}
        rows.append({'case':current['name'],'category':spec['category'],'current':comparable(current),'control':comparable(reference),'matches_design':comparable(current)==comparable(reference),'expected_failure_case':spec['category']=='failure'})
    normal=[r for r in rows if not r['expected_failure_case']]
    result={'normal_cases':len(normal),'current_design_matches':sum(r['matches_design'] for r in normal),'current_design_mismatches':[r['case'] for r in normal if not r['matches_design']],'control_design_matches':len(normal),'rows':rows,'note':'192 successful observation assertions include expected current defects; they do not mean current package passes the design.'}
    save(OUT/'design-matrix.json',result)
    return {k:v for k,v in result.items() if k!='rows'}
