"""Composable Android UI patch; only pinned target bodies plus one helper ABC change."""
import argparse
import copy
import importlib.util
import json
import os
import struct
import subprocess
import zlib
from pathlib import Path

import importlib.util as _quiet_importlib
import sys as _quiet_sys
_quiet_spec = _quiet_importlib.spec_from_file_location("starpoint_quiet_process", Path(__file__).resolve().parents[1] / 'quiet_process.py')
quiet = _quiet_importlib.module_from_spec(_quiet_spec)
_quiet_sys.modules[_quiet_spec.name] = quiet
_quiet_spec.loader.exec_module(quiet)
from types import SimpleNamespace

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('ui_patch_support',HERE.parent/'startup-cache/build_swf.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
SDK=Path(os.environ.get('STARPOINT_AIR_SDK', 'AIRSDK_51.2.1.5'))
JAVA=Path(os.environ.get('STARPOINT_JAVA', 'java'))
HELPER='cn.optimize.ui::UiOptimization'
POOL='pinball.scene.character.cell::PixelArtCharacterAnimationPool/getOrCreate|1'
POOL_DISPOSE='pinball.scene.character.cell::PixelArtCharacterAnimationPool/dispose|1'
PRESENT='pinball.scene.character.characterTable::CharacterTableView/present|1'
PATCH='pinball.scene.character.characterTable::CharacterTableView/applyPatch|1'
LIST_DISPOSE='pinball.scene.character.characterTable::CharacterTableView/dispose|1'
CELLS='pinball.scene.character.characterTable::CharacterTable/updateCells|1'
PAGE='pinball.scene.character.partyCarousel.page::PartyCarouselPageView/draw|1'
PAGE_DISPOSE='pinball.scene.character.partyCarousel.page::PartyCarouselPageView/dispose|1'
FINGERPRINTS={
 POOL:'e5edecf3fe1502b8f0f1825756ae83590e1dc43c302a0a40b818bcb1a6e2f7da',
 POOL_DISPOSE:'c20a3a8ad57d05f9e876cadf977f5cea03e50d08c16edc719f7b1e3dbea6b4b3',
 PRESENT:'c89bdddd20bc4bfd05a3c7dfb1cb2cb32d109aa676fab7b67f01b6ebfc934670',
 PATCH:'e4917e49f3034a996ba13688064aaea995196cf5133de97c6b6440f516b3834b',
 LIST_DISPOSE:'5e2eebcf467965296a5e4c351b70255df8b1ceef08e7f45b12df43209f4a84f4',
 CELLS:'ea7b61a9b8d575084b16e146026d7d55e845fe96d99c4a9dd03309137495e134',
 PAGE:'84c378e3de53a93742a14446913a3dcc721a4b6dabbcabda6de470cbd18e466b',
 PAGE_DISPOSE:'1e5b0c2d92c82ae4acf29548efbe1d3030fd90232d2e2cb487b2c8c4f8388186',
}

def view(a):return s.m.View(SimpleNamespace(abc=a),s.m.asm)

def q(a,ns,name):
 v=view(a);wanted=(7,(22,ns),name)
 hits=[i for i in range(1,len(a.multinames)) if v.mn(i)==wanted]
 if hits:return hits[0]
 pool=s.PoolEditor(a)
 spaces=[i for i,n in enumerate(a.namespaces) if i and n[0]==22 and a.s(n[1])==ns]
 if spaces:space=spaces[0]
 else:space=len(a.namespaces);a.namespaces.append((22,pool.string(ns)))
 a.multinames.append((7,space,pool.string(name)));return len(a.multinames)-1

def call_rows(a,name,locals_):
 return [('getlex',q(a,'cn.optimize.ui','UiOptimization'))]+[('getlocal',n) for n in locals_]+[('callproperty',q(a,'',name),len(locals_))]

def patch_body(a,label):
 v=view(a);bi,=v.by_label[label];b=a.bodies[bi];old=copy.deepcopy(b)
 assert s.sha(b[5])==FINGERPRINTS[label], 'unknown target method: '+label
 rows=s.m.asm.decode(b[5]);blocks=[]
 if label==POOL:
  remove,=[i for i,x in enumerate(rows) if x.op==0x4f and v.mn(x.args[0])==(7,(22,''),'remove')]
  at=remove-4
  assert rows[at].op==0x5e and v.mn(rows[at].args[0])==(7,(22,''),'map')
  block=s.m.asm.assemble(call_rows(a,'bucketHasRemainder',[0,1])+[('iffalse','END'),('jump','END')])
  block[-1].target=len(block)+(remove+1-at)
  blocks=[(at,block,s.m.asm.ENTER)]
 elif label==CELLS:
  # Keep the original z/alpha synchronization even when playheads can pause.
  # The view reads cell.alpha, not table.wholeAlpha; skipping those assignments
  # can leave an opaque stale sprite after the table is hidden or faded out.
  at=102
  assert rows[at].op==0x62 and tuple(rows[at].args)==(5,)
  assert rows[101].op==0x68 and view(a).mn(rows[101].args[0])[-1]=='alpha'
  assert rows[104].op==0xd1 and rows[108].target==22
  block=s.m.asm.assemble(call_rows(a,'shouldUpdateCell',[0,5])+[('iftrue','END'),('jump','END')])
  block[-1].target=len(block)+(104-at)
  blocks=[(at,block,s.m.asm.ENTER)]
 elif label==POOL_DISPOSE:
  ends=[i for i,x in enumerate(rows) if x.op==0x47];assert len(ends)==1
  block=s.m.asm.assemble(call_rows(a,'clearAnimationBuckets',[0])+[('pop',)])
  blocks=[(ends[0],block,s.m.asm.ENTER)]
 elif label in (PRESENT,PAGE):
  name='present' if label==PRESENT else 'skipPage'
  block=s.m.asm.assemble(call_rows(a,name,[0,1] if label==PRESENT else [0])+[('iffalse','END'),('returnvoid',)])
  blocks=[(2,block,s.m.asm.ENTER)]
  if label==PAGE:
   ends=[i for i,x in enumerate(rows) if x.op==0x47]
   assert len(ends)==1
   post=s.m.asm.assemble(call_rows(a,'afterPageDraw',[0])+[('pop',)])
   blocks.append((ends[0],post,s.m.asm.ENTER))
 else:
  name={PATCH:'invalidatePatch',LIST_DISPOSE:'disposeList',PAGE_DISPOSE:'disposePage'}[label]
  block=s.m.asm.assemble(call_rows(a,name,[0,1] if label==PATCH else [0])+[('pop',)])
  blocks=[(2,block,s.m.asm.ENTER)]
 b[5],b[6],_,placed=s.m.asm.splice_many(b,blocks)
 assert s.m.asm.unsplice_many(b[5],placed)==old[5]
 b[1]=max(b[1],5)
 check=s.m.check_body(b,a)
 return {'body':bi,'method':label,'original_code_sha256':FINGERPRINTS[label],
         'insertion_reversible':True,'added_instructions':sum(len(x[1]) for x in blocks),'check':check}

def compile_helper(work):
 work=Path(work);work.mkdir(parents=True,exist_ok=False);swc=work/'ui-helper.swc'
 command=[JAVA,'-Dflexlib='+str(SDK/'frameworks'),'-Xmx512m','-jar',SDK/'lib/compc-cli.jar',
  '+configname=air','-swf-version=44','-target-player=32.0','-debug=false','-compress=false','-compiler.float=false',
  '-compiler.source-path='+str(HERE/'src'),'-include-classes=cn.optimize.ui.UiOptimization','-output='+str(swc)]
 done=quiet.run([str(x) for x in command],capture_output=True,timeout=120)
 (work/'compile.log').write_bytes(done.stdout+done.stderr)
 assert done.returncode==0,'helper compile failed: '+str(work/'compile.log')
 return swc

def patch(source,output,helper=None):
 source,output=Path(source),Path(output)
 assert not output.exists() and source.resolve()!=output.resolve()
 assert '.cdn' not in [x.lower() for x in output.parts]
 if helper is None:helper=compile_helper(output.parent/(output.stem+'-helper'))
 version,header,tags=s.parts(source)
 matching=[t for t in tags if t[0]==82 and all(k in view(t[3]).by_label for k in FINGERPRINTS)]
 assert len(matching)==1
 main=matching[0];a=main[3];old=copy.deepcopy(a);changes=[]
 for label in FINGERPRINTS:changes.append(patch_body(a,label))
 actual=[i for i,b in enumerate(a.bodies) if s.m.freeze(b)!=s.m.freeze(old.bodies[i])]
 assert set(actual)=={r['body'] for r in changes}
 for field in ('methods','instances','classes','scripts','metadata'):
  assert s.m.freeze(getattr(a,field))==s.m.freeze(getattr(old,field)),field
 for field in ('ints','uints','doubles','strings','namespaces','ns_sets','multinames'):
  prefix=getattr(old,field);assert s.m.freeze(getattr(a,field)[:len(prefix)])==s.m.freeze(prefix),field
 payload=main[2]+s.serialize(a,main[4]);main[1]=struct.pack('<HI',(82<<6)|63,len(payload))+payload
 helper_abc=s.helper_abc(Path(helper))
 assert len(helper_abc.instances)==1 and helper_abc.mn_name(helper_abc.instances[0][0])==HELPER
 assert not any(t[0]==82 and any(t[3].mn_name(i[0])==HELPER for i in t[3].instances) for t in tags)
 for b in helper_abc.bodies:s.m.check_body(b,helper_abc)
 payload=struct.pack('<I',1)+b'cn.optimize.ui.UiOptimization\0'+helper_abc.serialize()
 helper_tag=struct.pack('<HI',(82<<6)|63,len(payload))+payload
 raw=header+b''.join((helper_tag if t is main else b'')+t[1] for t in tags)
 output.write_bytes(b'CWS'+bytes([version])+struct.pack('<I',len(raw)+8)+zlib.compress(raw))
 final=s.parts(output)[2]
 stripped=[t for t in final if t[0]!=82 or t[2][4:-1]!=b'cn.optimize.ui.UiOptimization']
 original=s.parts(source)[2]
 assert len(stripped)==len(original)
 changed=[i for i,(x,y) in enumerate(zip(original,stripped)) if x[1]!=y[1]]
 assert len(changed)==1
 for field in ('methods','instances','classes','scripts','metadata','bodies'):
  assert s.m.freeze(getattr(stripped[changed[0]][3],field))==s.m.freeze(getattr(a,field)),field
 report={'input_swf_sha256':s.sha(source.read_bytes()),'swf_sha256':s.sha(output.read_bytes()),
  'changes':changes,'helper':HELPER,'helper_methods':len(helper_abc.methods),'helper_bodies':len(helper_abc.bodies),
  'main_class_layouts_and_signatures_preserved':True,'all_non_target_methods_and_tags_preserved':True,
  'save_or_persistence_change':False,'verification_scope':'static readback; AIR/runtime report separate'}
 output.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n','utf-8');return report

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);parser.add_argument('output',type=Path)
 parser.add_argument('--helper',type=Path);args=parser.parse_args()
 print(json.dumps(patch(args.source,args.output,args.helper),indent=2))
