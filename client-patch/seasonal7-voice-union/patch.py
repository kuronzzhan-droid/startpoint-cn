"""Prepare a seven-character voice union SWF, preserving the current device base.

No APK installation or live data writes. Existing bytecode is retained exactly;
only four guarded voice methods receive insertions.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'abcasm'))
import asm
import bodies
from swfabc import SwfAbc, PoolEditor
import blocks

BASE_SHA='7221942332835732b11e38fc2172482f87069a05e514004f1939d6193dcbf59d'
TARGETS={
    'HudMemberStatus/update':('3d05c8e2c0bc0998e156108ac614cab5841d85cdb1ef35a41bd4d55df1ddbca5',172,5),
    'BattleCharacterLogic/resolveFollowingPathCollection':('628446aa3cf28af8b6f64a01d8681cc6f8722ab3c67a1db0a9a220063cd86141',134,12),
    'CharacterSpeechRepository/getJoinSpeech':('c18ec84ca9c7c14e8302f59b360282433173c60ebfb3e2a538e8802bc4454cf8',2,7),
    'CharacterSpeechRepository/getSpecificEvolutionSpeech':('148dddb8d07324f3042c017e909b39a2b1196811b548a615049dc809928a3e0d',2,11),
}
CONSTANTS={7439:'characterId',9733:'character',15727:'mainCharacterStringId',9604:'logic',
    7746:'logicAssets',46:'index',80:'params',11:'String',79:'haxe.ds::Option',241:'Some',
    83:'Math',277:'random',7494:'master',16832:'pinball.master.generated::CharacterSpeechValues',
    5119:'kind',9682:'evolution_level',35:'length',16839:'pinball.common.data.character::Speech',
    65:'http://adobe.com/AS3/2006/builtin::push',
    8215:'pinball.asset.logic:ILogicAssetContainer::existsVoiceFileReader',
    7784:'pinball.asset.logic:IAssetPathCollectionBuilder::addSoundEffect'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def apply(source:Path,output:Path,report:Path):
    if output.exists() or report.exists() or source.resolve()==output.resolve():
        raise ValueError('candidate outputs must be new')
    if sha(source.read_bytes())!=BASE_SHA:
        raise ValueError('source differs from inspected device base')
    swf=SwfAbc(source);abc=swf.abc
    for i,name in CONSTANTS.items():
        if abc.mn_name(i)!=name:
            raise ValueError(f'constant {i} differs: {abc.mn_name(i)}')
    before=[body[:] for body in abc.bodies]
    pool=PoolEditor(abc)
    code_blocks=[blocks.ready(pool),blocks.preload(pool),blocks.speech(pool),
                 blocks.speech(pool,evolution=True,first_local=8)]
    changes=[]
    for (name,(expected,at,locals_)),block in zip(TARGETS.items(),code_blocks):
        idx=bodies.resolve(abc,name);body=abc.bodies[idx]
        if sha(body[5])!=expected:
            raise ValueError('method drift: '+name)
        code,exceptions,instructions,locations=asm.splice_many(body,[(at,asm.assemble(block),asm.ENTER)])
        if asm.unsplice_many(code,locations)!=before[idx][5]:
            raise ValueError('original instruction stream changed')
        analysis=[asm.Instruction(0x02) if i.op in (0xef,0xf0,0xf1) else i for i in instructions]
        metrics=asm.simulate(analysis,body[3],abc.multinames)
        body[1]=max(body[1],metrics[0]);body[2]=max(body[2],locals_);body[4]=max(body[4],metrics[1])
        body[5],body[6]=code,exceptions
        changes.append(dict(method=name,index=idx,before=expected,after=sha(code),insertions=locations,
                            header=body[1:5],metrics=metrics))
    changed=[i for i,(a,b) in enumerate(zip(before,abc.bodies)) if a!=b]
    if set(changed)!={c['index'] for c in changes} or len(before)!=len(abc.bodies):
        raise ValueError('unexpected body changes')
    output.parent.mkdir(parents=True,exist_ok=True);swf.save(output)
    reread=SwfAbc(output)
    if reread.abc.serialize()!=abc.serialize():
        raise ValueError('SWF readback differs')
    result=dict(status='built_static_not_installed',capability='seasonal7-voice-union-v1',
        source=str(source),source_sha256=BASE_SHA,output=str(output),output_sha256=sha(output.read_bytes()),
        changed_methods=changes,unchanged_methods=len(before)-len(changes),pool=pool.report(),
        character_ids=list(blocks.ROSTER),device_or_store_writes=False)
    report.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    return result


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('source',type=Path);ap.add_argument('output',type=Path)
    ap.add_argument('--report',type=Path,required=True)
    args=ap.parse_args();print(json.dumps(apply(args.source,args.output,args.report),ensure_ascii=False))
