"""只读扫描 v35a 各 ABC，记录旧六路径和实际参战资源调用链证据。"""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bootstrap
import asm
import bodies
from common import abc_tags, listing
from swfabc import SwfAbc, abcfmt
from framework import sha
from visuals.helpers import LEGACY

HERE = Path(__file__).resolve().parent


def audit():
    references=[]
    for tag,*_,raw in abc_tags(bootstrap.BASE.read_bytes()):
        abc=abcfmt.ABC(raw)
        targets={i:abc.s(i) for i in range(1,len(abc.strings)) if abc.s(i) in LEGACY}
        if not targets:
            continue
        labels=bodies.label_map(abc)
        for bi,body in enumerate(abc.bodies):
            for at,ins in enumerate(asm.decode(body[5])):
                if ins.name=='pushstring' and ins.args[0] in targets:
                    references.append({'abc':tag.decode(),'method':labels.get(bi,f'anonymous:{bi}'),
                                       'instruction':at,'path':targets[ins.args[0]]})
    (HERE/'legacy-path-references.json').write_text(json.dumps(references,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    abc=SwfAbc(bootstrap.BASE).abc
    labels=['BattleAssetPathCollectionBuilder/addSingleQuest',
            'BattleAssetPathCollectionBuilder/addMultiQuest','BattlePartyLogic/resolvePathCollection',
            'MemberImpl/getCharacter']
    evidence={}
    for label in labels:
        body=abc.bodies[bodies.resolve(abc,label)]
        evidence[label]={'sha256':sha(body[5]),'header':body[1:5],
                         'pcode':listing(abc,body[5])}
    owner=next(i for i in range(1,len(abc.multinames))
               if abc.mn_name(i)=='pinball.common.data.character::BattleCharacterOwner')
    token=asm.encode(asm.assemble([('findpropstrict',owner)]))[0]
    for index,body in enumerate(abc.bodies):
        if token not in body[5]:
            continue
        if any(i.name=='constructprop' and i.args[0]==owner for i in asm.decode(body[5])):
            evidence['BattleCharacterOwner/enum-script-initializer']={
                'body':index,'sha256':sha(body[5]),'header':body[1:5],
                'pcode':listing(abc,body[5])}
    row=next(r for r in abc.instances if abc.mn_name(r[0]).endswith('::SquadMemberSource'))
    evidence['SquadMemberSource/fields']=[abc.mn_name(t.name) for t in row[6] if t.data[0]=='slot']
    (HERE/'runtime-origin-evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return {'path_references':len(references),'actual_v35a_methods':len(labels)}


if __name__=='__main__':
    print(json.dumps(audit(),ensure_ascii=False))
