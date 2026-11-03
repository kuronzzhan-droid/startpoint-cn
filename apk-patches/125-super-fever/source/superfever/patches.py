"""v35b现有方法体上叠加：有效入槽值及原生移除两处，状态缓存按需建立。"""
import asm
from .symbols import symbols,DEC
from . import state,grant,energy,lifecycle,bonus
TARGETS=['FeverPointGaugeImpl/addFeverPoint','ConditionSlot/removeCondition']

def build(e):
 m=symbols(e);q=m['q'];s=state.install(e,m)
 g=grant.install(e,m)
 emit=lifecycle.install_emit(e,m)
 end=lifecycle.install_end(e,m,s,g,emit,bonus.install(e,m))
 state.install_record(e,m,s)
 en=energy.install(e,m,s,g)
 # 旧04/724百分比缩放照旧；ClosedInterval原生加点前后取值差，包含减益后的实际入槽值及上限钳位。
 b=e.body(TARGETS[0]);ins=asm.decode(b[5]);assert ins[58].name=='callpropvoid' and ins[58].args[1]==1
 e.insert(TARGETS[0],52,[('getlocal_0',),('getproperty',q('feverPoint')),('getproperty',q('value')),('setlocal',5)])
 e.insert(TARGETS[0],59,[('getlocal_0',),('getlocal_0',),('getproperty',q('feverPoint')),('getproperty',q('value')),('getlocal',5),('subtract',),('callpropvoid',en,1)])
 b=e.body(TARGETS[1]);ins=asm.decode(b[5]);assert ins[195].name=='returnvoid'
 e.insert(TARGETS[1],195,[('getlocal_0',),('getlocal_3',),('callpropvoid',end,1)])
 return {'targets':TARGETS,'reference':4,'semantics':'state lifetime keyed by native slot+gid; retained through native stacking replacement'}
