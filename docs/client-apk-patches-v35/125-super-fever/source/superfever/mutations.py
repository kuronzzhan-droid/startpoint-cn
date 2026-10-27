"""逐一替换最终SWF真指令；每个探针均必须被行为回归检出。"""
import copy
import asm,bodies

def mutants(base,abc):
 for label in ['FeverPointGaugeImpl/addFeverPoint','ConditionSlot/removeCondition']:
  yield label+'.original_body_without_hook',{label:asm.decode(base.bodies[bodies.resolve(base,label)][5])}
 labels=['ConditionSlot/wfxSuperEntry','MemberImpl/wfxSuperGrant','MemberImpl/wfxSuperEmit',
         'ConditionSlot/wfxSuperEnd','MemberImpl/wfxSuperRecordDamage','FeverPointGaugeImpl/wfxSuperEnergy','MemberImpl/wfxSuperBonus']
 for label in labels:
  original=asm.decode(abc.bodies[bodies.resolve(abc,label)][5])
  early=[('getlocal_0',),('pushscope',),('pushnull',),('returnvalue',)] if label.endswith('Entry') else [('getlocal_0',),('pushscope',),('returnvoid',)]
  yield label+'.disabled',{label:asm.assemble(early)}
  for index,ins in enumerate(original):
   if ins.name in ['multiply','divide','add','subtract']:
    op={'multiply':'add','divide':'multiply','add':'subtract','subtract':'add'}[ins.name]
    code=copy.deepcopy(original);code[index]=asm.assemble([(op,)])[0]
    yield f'{label}.{index}.{ins.name}_to_{op}',{label:code}
  # Numeric semantics: WFX code gates, reference4, all-primary3, threshold>0.
  for value in [60,61,62,3,4,31]:
   candidates=[i for i,x in enumerate(original) if x.name=='pushbyte' and x.args[0]==value]
   # Array indexes 3/4 are not semantic selectors; select only following comparisons.
   candidates=[i for i in candidates if value in [60,61,62,31] or (i+1<len(original) and original[i+1].name in ['iflt','ifne'])]
   if candidates:
    index=candidates[-1];code=copy.deepcopy(original);code[index].args[0]=value+1
    yield f'{label}.{index}.constant{value}',{label:code}
 # Guards: force remote/non-primary/multiball paths through or reject all true local paths.
 label=labels[0];original=asm.decode(abc.bodies[bodies.resolve(abc,label)][5])
 for name in ['__isMyBattle__','isInPrimarySquad','isMultiball','isLeader']:
  for i,ins in enumerate(original):
   if ins.name=='callproperty' and abc.mn_name(ins.args[0]).split('::')[-1]==name:
    code=copy.deepcopy(original);j=i+1
    code[j].op=0x11 if original[j].name=='iffalse' else 0x12
    yield f'{label}.guard.{name}',{label:code}
    break
 label='MemberImpl/wfxSuperBonus';original=asm.decode(abc.bodies[bodies.resolve(abc,label)][5])
 for i,ins in enumerate(original):
  if ins.name=='callproperty' and abc.mn_name(ins.args[0]).split('::')[-1]=='indexOf':
   code=copy.deepcopy(original);code[i+2].op=0x15 # iflt in place of ifge: shared-slot identity guard inverted.
   yield label+'.shared_slot_dedup_inverted',{label:code}
   break
