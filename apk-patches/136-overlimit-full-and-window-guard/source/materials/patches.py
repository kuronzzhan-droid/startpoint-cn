"""第八轮材料入口固定 v35g 双锁与最小插入。"""
from pathlib import Path
import hashlib,json
import asm
from perf2_core import splice_with_exits
from materials.helper import install

TARGETS = [
 'OwnedOverLimitLogic/getOwnAwakingCrystalToOverLimit',
 'OwnedOverLimitLogic/getAwakingCrystalToOverLimit',
 'OwnedOverLimitLogic/getOverLimitState',
 'OwnedCharacterLogic/getPossibleOverLimitCountByItem',
 'OverLimitWindow/getOverLimitState',
 'OverLimitWindow/run',
 'OverLimitWindow/getStatusInformation',
 'ExpodOverLimitByItemDialog/getDescription',
]
LOCKS = {
 TARGETS[0]: {'sha':'2be9af1fa92ed8bb56a5ee90b9eb511f7f94c6941f38a223e406207e17be61b2','header':[3,12,1,2]},
 TARGETS[1]: {'sha':'2e584914a2f67e60a268e62502f8e7af84a6a6e1e38af444b8de79c446470b34','header':[3,13,1,2]},
 TARGETS[2]: {'sha':'98f9c7121ac212729daaf7a0e9b740e2de275dcc26e2536ad4d8e1d63d023fd0','header':[3,12,1,2]},
 TARGETS[3]: {'sha':'7fa65be8a2181e01a0a17b400d74fecbd0565c2600be4e78a7be8d96a94e837e','header':[3,6,1,2]},
 TARGETS[4]: {'sha':'ae683cc1f5574ac7b415c43cf779ea642535cd6a66531aa1ee51a150d1492068','header':[4,3,1,2]},
 TARGETS[5]: {'sha':'b96160fc0f1046a50cf78065ed8d907861a2a65fb13c4f365abad60cbd4b2a7e','header':[11,12,1,2]},
 TARGETS[6]: {'sha':'c64d19bbf7957fd9490406d4d251abb9d1e16eeb3062e1b49148f56afbd29aa4','header':[10,7,1,2]},
 TARGETS[7]: {'sha':'a0468818a62ad753f0d18a755b29af19c61ebf5c3cd4a145c7a5a8cfc8a8be55','header':[9,2,1,2]},
}
# (插入位置, 超限原分支入口, 角色读取属性)。原条件指令一字不删。
SITES = [(86,95,'character'),(97,106,'character'),(34,46,'character'),
         (18,28,None),(14,32,'targetCharacter'),(88,106,'targetCharacter'),
         (19,37,'targetCharacter'),(11,29,'character')]


def build(e):
    for label,lock in LOCKS.items():
        b=e.body(label)
        if hashlib.sha256(b[5]).hexdigest()!=lock['sha'] or b[1:5]!=lock['header']:
            raise asm.AsmError('materials unknown v35g SHA/header: '+label)
    full=install(e)
    for label,(at,target,prop) in zip(TARGETS,SITES):
        b=e.body(label);old=b[5];ins=asm.decode(old)
        source=[('getlocal_0',)]
        if prop:source += [('getproperty',e.q(prop))]
        source += [('callproperty',full,0),('iftrue','FULL')]
        raw,exc,_,count=splice_with_exits(b,at,source,{'FULL':target})
        assert asm.unsplice(raw,at,count)==old
        recovery=[(at,count,asm.FORBID)]
        if label==TARGETS[3]:
            # 原 returnvalue 后的不可达 jump 指向原 code 终点；追加合法封闭落点，保留全部原字节。
            tail_at=len(asm.decode(raw));working=list(b);working[5]=raw;working[6]=exc
            raw,exc,_=asm.splice(working,tail_at,asm.assemble([('avm_label',),('pushbyte',0),('returnvalue',)]),asm.ENTER)
            recovery.append((tail_at,3,asm.ENTER))
        assert asm.unsplice_many(raw,recovery)==old
        e.replace(label,raw,exc)
        e.report[label]['insertions']=recovery
        e.report[label]['full_mode']={'helper':'GeneralCharacterLogic/wfxOverlimitFull',
          'old_mode_entry':target,'new_mode_entry':target+count,
          'no_key_original_instructions_exactly_recoverable':True}
    return {'capability':'wfx-overlimit-full-v1','targets':TARGETS,
            'helper':'GeneralCharacterLogic/wfxOverlimitFull',
            'key':'wfx_overlimit_full_<id>','value':'1'}
