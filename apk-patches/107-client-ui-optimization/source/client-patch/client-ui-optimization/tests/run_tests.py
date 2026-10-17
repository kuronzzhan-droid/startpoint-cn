"""Execute old/new current game AVM2 UI controllers with controlled AIR resources."""
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
spec=importlib.util.spec_from_file_location('ui_patch',HERE.parent/'patch_swf.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

def command(args,log):
 done=quiet.run([str(x) for x in args],capture_output=True,timeout=120)
 log.write_bytes(done.stdout+done.stderr);assert done.returncode==0,'see '+str(log)

def run(source,work):
 work=Path(work);work.mkdir(parents=True,exist_ok=False)
 original=work/'fixture-original.swf'
 command([p.JAVA,'-Dflexlib='+str(p.SDK/'frameworks'),'-Xmx512m','-jar',p.SDK/'lib/mxmlc-cli.jar',
  '+configname=air','-swf-version=44','-target-player=32.0','-debug=false','-compress=false','-compiler.float=false',
  '-compiler.source-path='+str(HERE),'-compiler.source-path+='+str(HERE/'fixtures'),
  '-compiler.source-path+='+str(HERE.parent/'src'),'-output='+str(original),HERE/'RuntimeHarness.as'],work/'compile.log')
 version,header,tags=p.s.parts(original)
 fixture_tag,=[t for t in tags if t[0]==82 and any('TestAnimationPool/getOld|' in x for x in p.view(t[3]).by_label)]
 a=fixture_tag[3];fixture=p.view(a)
 source_tag,=[t for t in p.s.parts(source)[2] if t[0]==82 and p.POOL in p.view(t[3]).by_label]
 baseline=p.view(source_tag[3]);modified=copy.deepcopy(source_tag[3])
 for label in p.FINGERPRINTS:p.patch_body(modified,label)
 optimized=p.view(modified)
 aliases={
  'flatomo.animation::Animation':'TestAnimation','haxe.ds::IntMap':'TestIntMap','haxe::IMap':'Object',
  'flatomo.timeline::Playhead':'TestTimeline',
  'pinball.common.ds::Lazy':'TestLazy',
  'pinball.asset.logic::TimelineLoadInput':'TestLoadInput','pinball.asset.logic::LogicAssetContainer':'TestLogicAsset',
  'pinball.scene.character.cell::CharacterCellCharacterPlayhead':'TestHead','pinball.ui::UIPlayhead':'TestMotion',
  'haxe.ds._IntMap::IntMapKeysIterator':'TestKeysIterator','haxe.ds._IntMap::IntMapValuesIterator':'TestValuesIterator',
  'haxe.ds._StringMap::StringMapValuesIterator':'TestValuesIterator',
  'pinball.scene.character.cell::CharacterCellView':'TestCellView','pinball.scene.character.cell::CharacterCell':'TestCell',
  'pinball.scene.character.cell::CharacterCellPeek':'TestCell','pinball.common.ds::OrderedMap':'TestOrderedMap',
  'Std':'TestStd','flash::Boot':'TestBoot','pinball.asset::FileUtilCommon':'TestFiles','pinball.error::ClientError':'TestClientError',
  'pinball.scene.character.partyCarousel.page::PartyCarouselMemberView':'TestMember',
  'pinball.scene.character.partyCarousel.page::PartyCarouselAbilitySoulView':'TestSoul',
  'starling.display::DisplayObjectContainer':'Object',
  'pinball.ui.display::UiDisplayObjectContainer':'Object',
  'pinball.common.ds._Maybe::Maybe_Impl_':'TestMaybe','Reflect':'TestReflect',
  'pinball.common.data.party::InventoryPlaceKind':'TestEnum',
  'pinball.scene.character.translator::InventoryCharacterState':'TestEnum',
  'pinball.scene.character.translator::InventoryCharacterAccessoryKind':'TestEnum',
  'pinball.scene.character.translator::PixelArtCharacterKind':'TestEnum',
 }
 rows=[
  ('pinball.common.ds::Lazy/<ctor>','TestLazy/<ctor>',False),
  ('pinball.common.ds::Lazy/get|1','TestLazy/get|1',False),
  (p.POOL,'TestAnimationPool/getOld|1',False),(p.POOL,'TestAnimationPool/getNew|1',True),
  ('pinball.scene.character.cell::PixelArtCharacterAnimationPool/dispose|1','TestAnimationPool/disposeReal|1',False),
  (p.POOL_DISPOSE,'TestAnimationPool/disposeNew|1',True),
  (p.PRESENT,'TestListView/presentOld|1',False),(p.PRESENT,'TestListView/presentNew|1',True),
  (p.PATCH,'TestListView/applyPatchNew|1',True),(p.LIST_DISPOSE,'TestListView/disposeNew|1',True),
  (p.CELLS,'TestTable/updateOld|1',False),(p.CELLS,'TestTable/updateNew|1',True),
  (p.PAGE,'TestPage/drawOld|1',False),(p.PAGE,'TestPage/drawNew|1',True),(p.PAGE_DISPOSE,'TestPage/disposeNew|1',True),
  ('pinball.scene.character.cell::CharacterCellView/apply|1','TestCellView/applyReal|1',False),
  ('pinball.scene.character.cell::CharacterCellView/isWithinScreen|1','TestCellView/isWithinScreen|1',False),
  ('pinball.scene.character.cell::CharacterCellViewDataSourceKindTools$/clone|1','CharacterCellViewDataSourceKindTools$/clone|1',False),
  ('pinball.scene.character.cell::CharacterCell/isFalling|1','TestCell/isFalling|1',False),
  ('pinball.scene.character.cell::CharacterCell/isWithInScreen|1','TestCell/isWithInScreen|1',False),
  ('pinball.scene.character.cell::CharacterCell/update|1','TestCell/updateReal|1',False),
  ('pinball.scene.character.cell::CharacterCell/updatePlayheads|1','TestCell/updatePlayheads|1',False),
  ('pinball.scene.character.cell::CharacterCell/isJoinOrRemoving|1','TestCell/isJoinOrRemoving|1',False),
  ('pinball.scene.character.cell::CharacterCellCharacterPlayhead/get_isPlayingKachidokiOnce|1','TestHead/get_isPlayingKachidokiOnce|1',False),
  ('pinball.scene.character.cell::CharacterCellCharacterPlayhead/advanceFrame|1','TestHead/advanceFrame|1',False),
  ('pinball.scene.character.cell::CharacterCellCharacterPlayhead/advanceFrameUsually|1','TestHead/advanceFrameUsually|1',False),
  ('pinball.scene.character.cell::CharacterCellCharacterPlayhead/timelineLoadHandler|1','TestHead/timelineLoadHandler|1',False),
 ]
 evidence=[]
 for donor in (baseline,optimized):
  importer=p.s.m.Importer(fixture,donor)
  for source_name,target_name in aliases.items():
   for mi in range(1,len(donor.a.multinames)):
    if donor.a.mn_name(mi)==source_name:
     if target_name=='Object':ti=p.q(a,'','Object')
     else:ti,=[row[0] for row in a.instances if fixture.mn(row[0])[-1]==target_name]
     importer.cache[('multinames',mi)]=ti
  # Game interface calls use owner-qualified namespaces; controlled fixture
  # implementations expose the same methods as ordinary public methods.
  for mi in range(1,len(donor.a.multinames)):
   name=donor.mn(mi)
   if name[0]==7 and name[1][0] in (8,22) and name[1][1].startswith('pinball.') and ':' in name[1][1]:
    importer.cache[('multinames',mi)]=p.q(a,'',name[2])
  for label,target,is_new in rows:
   if is_new != (donor is optimized):continue
   source_bi,=donor.by_label[label]
   target_bi,=[ids[0] for name,ids in fixture.by_label.items() if name.endswith(target)]
   old=a.bodies[target_bi]
   a.bodies[target_bi]=importer.body(source_bi,old[0],scope=old[3])
   check=p.s.m.check_body(a.bodies[target_bi],a)
   evidence.append({'method':label,'source_body':source_bi,'fixture':target,'optimized':is_new,'check':check})
 payload=fixture_tag[2]+p.s.serialize(a,fixture_tag[4])
 fixture_tag[1]=struct.pack('<HI',(82<<6)|63,len(payload))+payload
 raw=header+b''.join(t[1] for t in tags)
 (work/'RuntimeHarness.swf').write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
 done=quiet.run([str(p.SDK/'bin/adl.exe'),str(HERE/'harness-app.xml'),str(work)],capture_output=True,timeout=60)
 (work/'adl.log').write_bytes(done.stdout+done.stderr)
 result=json.loads((work/'runtime-tests.json').read_text('utf-8'))
 result.update({'adl_exit_code':done.returncode,'current_game_controller_methods':evidence,
  'scope':'actual old/new AVM2 controllers and helper on AIR; texture/display/animation bottoms controlled, no device acceptance'})
 (work/'runtime-tests.json').write_text(json.dumps(result,indent=2)+'\n','utf-8')
 assert done.returncode==0 and result['passed'],result
 return result

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);parser.add_argument('work',type=Path);args=parser.parse_args()
 print(json.dumps(run(args.source,args.work),indent=2))
