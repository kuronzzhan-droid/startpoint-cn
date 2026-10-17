"""Execute exact baseline/patched badge methods, Lazy and quest-group AVM2."""
import argparse,copy,importlib.util,json,struct,zlib
from pathlib import Path

import importlib.util as _quiet_importlib
import sys as _quiet_sys
_quiet_spec = _quiet_importlib.spec_from_file_location("starpoint_quiet_process", Path(__file__).resolve().parents[2] / 'quiet_process.py')
quiet = _quiet_importlib.module_from_spec(_quiet_spec)
_quiet_sys.modules[_quiet_spec.name] = quiet
_quiet_spec.loader.exec_module(quiet)
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('badge_support',HERE/'run_tests.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r);p=r.p

def run(before,after,work):
 work.mkdir(parents=True,exist_ok=False);helper=p.compile_helper(work/'helper')
 r.command([p.JAVA,'-Dflexlib='+str(p.SDK/'frameworks'),'-Xmx512m','-jar',p.SDK/'lib/mxmlc-cli.jar','+configname=air','-swf-version=32','-target-player=21.0','-compiler.float=false','-debug=false','-compress=false','-external-library-path+='+str(work/'helper/data-optimization.swc'),'-compiler.source-path='+str(HERE),'-compiler.source-path+='+str(HERE/'badge-fixtures'),'-output='+str(work/'compiled.swf'),HERE/'BadgeHarness.as'],work/'compile.log')
 old,new=r.main_abc(before),r.main_abc(after);version,header,tags=p.s.parts(work/'compiled.swf')
 target,=[t for t in tags if t[0]==82 and 'cn.optimize.tests::BadgeProbe/before|1' in p.view(t[3]).by_label]
 a=target[3];v=p.view(a);grafts=[];interface_cache={}
 def install(donor,label,to_label=None):
  to_label=to_label or label;di,_=p.label_body(donor,label);ti,body=p.label_body(a,to_label);meta=body[:5]
  imp=p.s.m.Importer(v,p.view(donor))
  if id(donor) not in interface_cache:
   aliases={}
   for mi in range(1,len(donor.multinames)):
    mn=p.view(donor).mn(mi)
    if mn[0]==7 and mn[1][0] in (8,22) and mn[1][1].startswith('pinball.') and ':' in mn[1][1]:aliases[mi]=p.q(a,'',mn[2])
    if mn in [(7,(22,'haxe'),'IMap'),(7,(22,'haxe.ds'),'IntMap')]:aliases[mi]=p.q(a,'','Object')
   interface_cache[id(donor)]=aliases
  for mi,alias in interface_cache[id(donor)].items():imp.cache[('multinames',mi)]=alias
  imported=imp.body(di,body[0]);delta=imported[4]-imported[3];imported[3]=meta[3];imported[4]=meta[3]+delta;imported[1]=max(imported[1],10);a.bodies[ti]=imported
  grafts.append({'from':label,'to':to_label,'source_code_sha256':p.s.sha(donor.bodies[di][5]),'check':p.s.m.check_body(imported,a)})
 label='pinball.scene.character.translator::CharacterTranslator/getBadgeReasonMethod|1'
 install(old,label,'cn.optimize.tests::BadgeProbe/before|1');install(new,label,'cn.optimize.tests::BadgeProbe/after|1')
 install(old,'pinball.common.data.quest.repository::QuestRepository/getCharacterQuestGroup|1','pinball.common.data.quest.repository::QuestRepository/core|1')
 for label in ['pinball.common.ds::Lazy/<ctor>','pinball.common.ds::Lazy/get|1','pinball.common.data.quest.repository::CharacterQuestGroup/<ctor>','pinball.common.data.quest.repository::CharacterQuestGroup/containsNotClearedAndSelectableCharacterQuests|1','pinball.common.data.quest.repository::CharacterQuestGroup/_getContainsNotClearedAndSelectableCharacterQuests|1','pinball.common.tools._FunctionTools::BindImpl1_0/<ctor>','pinball.common.tools._FunctionTools::BindImpl1_0/execute|1','pinball.common.tools._FunctionTools::BindImpl2_0/<ctor>','pinball.common.tools._FunctionTools::BindImpl2_0/execute|1','pinball.common.time._AppTime::AppTime_Impl_$/getTime|1']:install(old,label)
 payload=target[2]+p.s.serialize(a,target[4]);target[1]=struct.pack('<HI',(82<<6)|63,len(payload))+payload
 production,=[t for t in p.s.parts(after)[2] if t[0]==82 and t[2][4:-1].decode()==p.HELPER];assert production[3].serialize()==helper.serialize()
 raw=header+b''.join((production[1] if t is target else b'')+t[1] for t in tags);(work/'BadgeHarness.swf').write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
 (work/'application.xml').write_text('<application xmlns="http://ns.adobe.com/air/application/51.0"><id>cn.optimize.data.badge.tests</id><versionNumber>1.0.0</versionNumber><filename>BadgeTests</filename><initialWindow><content>BadgeHarness.swf</content><visible>false</visible><width>1</width><height>1</height></initialWindow></application>')
 result=quiet.run([str(p.SDK/'bin/adl.exe'),str(work/'application.xml'),str(work)],capture_output=True,timeout=30);(work/'runtime.log').write_bytes(result.stdout+result.stderr);report=json.loads((work/'badge-tests.json').read_text());assert report['passed'],report
 report.update({'grafted_actual_methods':grafts,'production_helper_exact':True,'production_helper_abc_sha256':p.s.sha(production[4]),'input_before_sha256':p.s.sha(before.read_bytes()),'input_after_sha256':p.s.sha(after.read_bytes()),'compiler_float':False,'compiled_abc_major':46,'boundary':'Actual badge, Lazy, repository construction, group cache/filter and Bind AVM2; bounded master/player/quest/character fixtures. Visible get is simulated; no actual game renderer/device or frame-rate claim. Stable session master and repository cache assumption. Lookup exceptions intentionally move to first Lazy get; original player/time/id captured, player object remains live.'})
 (work/'verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='grafted_actual_methods'}))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('before',type=Path);parser.add_argument('after',type=Path);parser.add_argument('work',type=Path);args=parser.parse_args();run(args.before,args.after,args.work)
