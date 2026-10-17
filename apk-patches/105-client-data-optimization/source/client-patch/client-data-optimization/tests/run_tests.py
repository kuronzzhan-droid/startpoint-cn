"""Execute actual before/after game AVM2 plus the exact production helper ABC."""
import argparse
import copy
import importlib.util
import json
import struct
import subprocess
import zlib
from pathlib import Path

import importlib.util as _quiet_importlib
import sys as _quiet_sys
_quiet_spec = _quiet_importlib.spec_from_file_location("starpoint_quiet_process", Path(__file__).resolve().parents[2] / 'quiet_process.py')
quiet = _quiet_importlib.module_from_spec(_quiet_spec)
_quiet_sys.modules[_quiet_spec.name] = quiet
_quiet_spec.loader.exec_module(quiet)

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('data_test_patch',HERE.parent/'patch_swf.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

def command(args,log):
    result=quiet.run([str(x) for x in args],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=90)
    log.write_text(result.stdout+result.stderr,encoding='utf-8')
    assert result.returncode==0,str(log)

def main_abc(path):return next(t[3] for t in p.s.parts(path)[2] if t[0]==82 and t[2][4:-1]==b'boot_ffc6')

def run(before,after,work,old_optimized=None,r3=None):
    assert old_optimized is not None and r3 is not None,'R2 G1002 and R3 duplicate-translation controls are required'
    work.mkdir(parents=True,exist_ok=True)
    helper=p.compile_helper(work/'helper')
    command([p.JAVA,'-Dflexlib='+str(p.SDK/'frameworks'),'-Xmx512m','-jar',p.SDK/'lib/mxmlc-cli.jar',
             '+configname=air','-swf-version=32','-target-player=21.0','-compiler.float=false','-debug=false','-compress=false',
             '-external-library-path+='+str(work/'helper/data-optimization.swc'),'-compiler.source-path='+str(HERE),
             '-compiler.source-path+='+str(HERE/'fixtures'),'-output='+str(work/'compiled.swf'),HERE/'RuntimeHarness.as'],work/'compile.log')
    old,new=main_abc(before),main_abc(after)
    version,header,tags=p.s.parts(work/'compiled.swf')
    target,=[t for t in tags if t[0]==82 and 'cn.optimize.tests::TableProbe/before|1' in p.view(t[3]).by_label]
    abc=target[3];v=p.view(abc);grafts=[]
    def install(source,label,to_label,body_override=None,helper_namespace=None,interfaces=False):
        donor=source
        if body_override is not None:
            donor=copy.deepcopy(source);index,_=p.label_body(donor,label);donor.bodies[index]=body_override
        di,_=p.label_body(donor,label);ti,original=p.label_body(abc,to_label)
        meta=original[:5]
        importer=p.s.m.Importer(v,p.view(donor))
        for mi in (range(1,len(donor.multinames)) if helper_namespace or interfaces else []):
            name=p.view(donor).mn(mi)
            if helper_namespace and name==(7,(22,'cn.optimize.data'),'DataOptimization'):
                importer.cache[('multinames',mi)]=p.q(abc,helper_namespace,'DataOptimization')
            if interfaces and name[0]==7 and name[1][0] in (8,22) and name[1][1].startswith('pinball.') and ':' in name[1][1]:
                importer.cache[('multinames',mi)]=p.q(abc,'',name[2])
            if interfaces and name==(7,(22,'pinball.scene.character.partyCarousel.page'),'PartyCarouselPageView'):
                importer.cache[('multinames',mi)]=p.q(abc,'cn.optimize.tests','PageProbe')
            if interfaces and name==(7,(22,'pinball.ui.display'),'UiDisplayObjectContainer'):
                importer.cache[('multinames',mi)]=p.q(abc,'','Object')
            if interfaces and name[0]==7 and name[1]==(22,'pinball.scene.character.partyCarousel.page') and name[2] in ('PartyCarouselAbilitySoulView','PartyCarouselMemberView'):
                importer.cache[('multinames',mi)]=p.q(abc,'','Object')
            if interfaces and name[0]==7 and (name[1],name[2]) in [((22,'pinball.common.data.party'),'PartyGroupLogic'),((22,'pinball.scene.character.partyCarousel.characterContainer'),'PartyCharacterCellContainer')]:
                importer.cache[('multinames',mi)]=p.q(abc,'','Object')
        imported=importer.body(di,original[0])
        delta=imported[4]-imported[3]
        imported[3]=meta[3];imported[4]=meta[3]+delta
        imported[1]=max(imported[1],8)
        abc.bodies[ti]=imported
        check=p.s.m.check_body(imported,abc)
        grafts.append({'from':label,'to':to_label,'source_code_sha256':p.s.sha(donor.bodies[di][5]),'check':check})
    for source,suffix in ((old,'before'),(new,'after')):
        install(source,'pinball.scene.character.characterTable::CharacterTable/applyCharacters|1','cn.optimize.tests::TableProbe/'+suffix+'|1')
        install(source,'pinball.scene.character.characterList::CharacterListCachedRepository/find|1','cn.optimize.tests::RepositoryProbe/'+suffix+'|1')
        install(source,'pinball.scene.character.partyCarousel::PartyCarousel/applyDetailSetting|1','cn.optimize.tests::CarouselProbe/'+suffix+'Details|1')
        install(source,'pinball.scene.character.partyCarousel::PartyCarousel/getPartyData|1','cn.optimize.tests::CarouselProbe/'+suffix+'Data|1')
        install(source,'pinball.common.data.character::BattleCharacterLogic/getLearnedManaNodes|1',
                'pinball.common.data.character::BattleCharacterLogic/'+('originalNodes' if suffix=='before' else 'optimizedNodes')+'|1')
        # The first constructor/getter region is branch-free; run its exact
        # instructions with preseeded locals and return the three actual Options.
        label='pinball.scene.character.translator::PartyTranslator/createStatus|1'
        di,original=p.label_body(source,label);body=copy.deepcopy(original)
        instructions=p.s.m.asm.decode(body[5]);end=255 if suffix=='before' else 253
        segment=copy.deepcopy(instructions[215:end]);assert all(x.target is None and x.cases is None for x in segment)
        prelude=p.s.m.asm.assemble([('getlocal_0',),('pushscope',),('getlocal_1',),('setlocal',20),
             ('getlex',p.q(source,'haxe.ds','Option')),('getlocal_2',),('callproperty',p.q(source,'','Some'),1),('setlocal',19),
             ('pushstring',p.s.PoolEditor(source).string('thresholdMode')),('getlocal_3',),('newobject',1),('setlocal',9)])
        tail=p.s.m.asm.assemble([('getlocal',16),('getlocal',17),('getlocal',18),('newarray',3),('returnvalue',)])
        body[5]=p.s.m.asm.encode(prelude+segment+tail)[0];body[6]=[]
        install(source,label,'cn.optimize.tests::GaugeProbe/'+suffix+'|1',body)
    install(new,'pinball.scene.character.characterList::CharacterListCachedRepository/clearCache|1','cn.optimize.tests::RepositoryProbe/clearCache|1')
    install(new,'pinball.scene.character.partyCarousel::PartyCarousel/applyParty|1','cn.optimize.tests::CarouselProbe/applyParty|1',interfaces=True)
    for label,target_label in [('initialzeAt','initialzeAt'),('getCurrentPartyData','getCurrentPartyData'),('partyChanged','partyChangedFixed')]:
        install(new,'pinball.scene.character.partyCarousel::PartyCarousel/'+label+'|1','cn.optimize.tests::CarouselProbe/'+target_label+'|1',interfaces=True)
    install(old,'pinball.scene.character.partyCarousel::PartyCarousel/partyChanged|1','cn.optimize.tests::CarouselProbe/partyChangedBaseline|1',interfaces=True)
    if r3 is not None:install(main_abc(r3),'pinball.scene.character.partyCarousel::PartyCarousel/partyChanged|1','cn.optimize.tests::CarouselProbe/partyChangedR3|1',interfaces=True)
    party_index='pinball.common.data.party._PartyIndex::PartyIndex_Impl_$/fromPartyId|1'
    install(old,party_index,party_index,interfaces=True)
    for label,target_label in [
        ('pinball.scene.character.partyCarousel.page::PartyCarouselPageView/present|1','cn.optimize.tests::PageProbe/present|1'),
        ('pinball.scene.character.partyCarousel.page::PartyCarouselPageView/apply|1','cn.optimize.tests::PageProbe/apply|1'),
        ('pinball.scene.character.partyCarousel::PartyCarouselView/onPresentCarouselPage|1','cn.optimize.tests::CarouselViewProbe/onPresentCarouselPage|1')]:
        install(old,label,target_label,interfaces=True)
    old_helper_tag=b''
    if old_optimized is not None:
        old_main=main_abc(old_optimized)
        install(old_main,'pinball.scene.character.partyCarousel::PartyCarousel/getPartyData|1','cn.optimize.tests::CarouselProbe/oldOptimizedData|1',helper_namespace='cn.optimize.data.r2')
        previous=copy.deepcopy(next(t[3] for t in p.s.parts(old_optimized)[2] if t[0]==82 and t[2][4:-1].decode()==p.HELPER))
        for ni,(kind,si) in enumerate(previous.namespaces):
            if kind==22 and previous.s(si)=='cn.optimize.data':
                previous.namespaces[ni]=(kind,p.s.PoolEditor(previous).string('cn.optimize.data.r2'))
        payload=struct.pack('<I',1)+b'cn.optimize.data.r2.DataOptimization\0'+previous.serialize()
        old_helper_tag=struct.pack('<HI',(82<<6)|63,len(payload))+payload
    ctor='pinball.common.data.ability.summary::AbilityTotalizedSummary/<ctor>'
    install(old,ctor,ctor)
    comparator_labels=[label for label in v.by_label if label.startswith('pinball.common.data.character.repository::OwnedCharacterRepository$/characterCompare') or label=='pinball.common.data.character.repository::OwnedCharacterRepository$/getCharacterComparatorBy|1']
    assert len(comparator_labels)==14
    for label in comparator_labels:
        if label in p.view(old).by_label:
            install(old,label,label)
    element='pinball.common.data.general::ElementKindTools$/getIndex|1'
    install(old,element,element)
    _,scope=p.label_body(abc,'cn.optimize.tests::ScopeProbe/execute|1')
    p.scope_body(abc,scope);p.s.m.check_body(scope,abc)
    # ScopeProbe uses the exact production insertion generator, including its
    # catch-all exception table; exercise success, nested calls and thrown errors.
    payload=target[2]+p.s.serialize(abc,target[4]);target[1]=struct.pack('<HI',(82<<6)|63,len(payload))+payload
    production_helper,=[t for t in p.s.parts(after)[2] if t[0]==82 and t[2][4:-1].decode()==p.HELPER]
    assert production_helper[3].serialize()==helper.serialize(),'helper differs from production'
    raw=header+b''.join((old_helper_tag+production_helper[1] if t is target else b'')+t[1] for t in tags)
    (work/'RuntimeHarness.swf').write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
    command([p.SDK/'bin/adl.exe',HERE/'harness-app.xml',work],work/'runtime.log')
    report=json.loads((work/'runtime-tests.json').read_text(encoding='utf-8'))
    assert report['passed'],report
    report.update({'grafted_actual_methods':grafts,'production_helper_exact':True,
                   'production_helper_abc_sha256':p.s.sha(production_helper[4]),
                   'fixture_aliases':{'PartyCarouselPageView':'PageProbe','PartyGroupLogic':'Object','PartyCharacterCellContainer':'Object','UiDisplayObjectContainer':'Object','PartyCarouselMemberView':'Object','PartyCarouselAbilitySoulView':'Object','owner-qualified interfaces':'public fixture methods'},
                   'dispatcher_guard_scope':'controlled synchronous non-reentrant dispatcher; actual game page/view/partyChanged/applyParty AVM2',
                   'scope_test_exception_table':scope[6],'input_before_sha256':p.s.sha(before.read_bytes()),
                   'input_after_sha256':p.s.sha(after.read_bytes()),'compiler_float':False,'compiled_abc_major':46,
                   'r2_regression_input_sha256':p.s.sha(old_optimized.read_bytes()) if old_optimized is not None else None})
    report['r3_translation_regression_input_sha256']=p.s.sha(r3.read_bytes()) if r3 is not None else None
    (work/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='grafted_actual_methods'},ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('before',type=Path);parser.add_argument('after',type=Path);parser.add_argument('work',type=Path);parser.add_argument('--old-optimized',type=Path,required=True);parser.add_argument('--r3',type=Path,required=True)
    a=parser.parse_args();run(a.before,a.after,a.work,a.old_optimized,a.r3)
