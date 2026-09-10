"""Bind enemy sunburn stacks to the native non-hostile ability resistance side."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys

REPO=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(REPO/'client-patch/abcasm'))
import asm
import bodies
from swfabc import PoolEditor,SwfAbc

ACCEPTED_INPUTS={
    'dee19b6a96d8cece93021c09f937fdf35832ed362dcbf9b9df0b8750a3774572',
    '05f9f72c7dbe1d90d0405457cf2cd59e4e579311ae2ca6f3466b04ff8e4b3e19',
}
METHOD='ConditionSlot/getOneSideTotalAbilityDamageResistance'
CODE_SHA='45132366ca9add7dbfc334bebfc726287a28bf1d3dea2cf84f96b2cdf2b16a30'
CAPABILITY='summer-bai-sunburn-resistance-v1'


def sha(data):return hashlib.sha256(data).hexdigest()


def block(pool):
    # Existing local 4 is the exhausted loop index; no later native instruction
    # reads it. Keep the native total in local 3 and the existing return intact.
    return asm.assemble([
        ('getlocal_1',),('iftrue','END'),
        ('getlocal_0',),('callproperty',30682,0),('iftrue','END'),
        ('getlocal_0',),('getproperty',42297),('getproperty',46),
        ('pushbyte',2),('ifne','END'),
        ('getlocal_0',),('getlex',8990),('pushint',pool.integer(1499901)),
        ('callproperty',3103,1),('coerce',8990),
        ('callproperty',9155,1),('convert_i',),('setlocal',4),
        ('getlocal',4),('pushbyte',0),('ifle','END'),
        ('getlocal',4),('pushbyte',3),('ifle','COUNT_OK'),
        ('pushbyte',3),('setlocal',4),('label','COUNT_OK'),
        ('getlocal_3',),('getlocal',4),('pushint',pool.integer(15000)),
        ('multiply',),('subtract',),('convert_d',),('setlocal_3',),
        ('label','END'),
    ])


def apply(source,output,report):
    source,output,report=map(Path,(source,output,report))
    if output.exists()or source.resolve()==output.resolve():
        raise asm.AsmError('output must be new')
    source_sha=sha(source.read_bytes())
    if source_sha not in ACCEPTED_INPUTS:raise asm.AsmError('unknown input SWF')
    swf=SwfAbc(source);a=swf.abc;idx=bodies.resolve(a,METHOD);b=a.bodies[idx]
    if sha(b[5])!=CODE_SHA or b[1:5]!=[3,13,1,2] or b[6]:
        raise asm.AsmError('getter differs from reviewed native baseline')
    original=[x[:]for x in a.bodies]
    old=b[5];pool=PoolEditor(a);insertion=block(pool)
    code,exceptions,ins=asm.splice(b,241,insertion,incoming=asm.ENTER)
    if asm.unsplice(code,241,len(insertion))!=old:raise asm.AsmError('native bytecode changed')
    metrics=asm.simulate(ins,b[3],a.multinames)
    if metrics[:2]!=(3,2):raise asm.AsmError('unexpected stack/scope change')
    b[5],b[6]=code,exceptions
    changed=[i for i,(x,y)in enumerate(zip(original,a.bodies))if x!=y]
    if changed!=[idx]:raise asm.AsmError('unrelated body changed')
    swf.save(output)
    result={'status':'static_built_runtime_pending','capability':CAPABILITY,
            'source':str(source),'source_sha256':source_sha,'output':str(output),
            'output_sha256':sha(output.read_bytes()),'method':METHOD,'body_index':idx,
            'original_code_sha256':CODE_SHA,'patched_code_sha256':sha(code),
            'insert_at':241,'insert_count':len(insertion),'metrics':metrics,
            'unchanged_method_bodies':len(a.bodies)-1,'pool':pool.report(),
            'data_requirement':'Remove old ability 1499903 during171 -> content348 additive row',
            'invisible_slot_sunburn_delta_zero':True,
            'other_damage_channels_changed':False}
    report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--report',type=Path,required=True);x=p.parse_args()
    print(json.dumps(apply(x.source,x.output,x.report),ensure_ascii=False,indent=2))
