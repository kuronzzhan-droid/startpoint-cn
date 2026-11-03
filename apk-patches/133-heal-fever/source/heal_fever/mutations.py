"""破坏最终助手的真实AVM指令；每个变异都必须被行为用例检出。"""
import copy
import asm, bodies
LABEL='MemberImpl/wfxHealFever'


def mutants(abc):
    code=asm.decode(abc.bodies[bodies.resolve(abc,LABEL)][5])
    yield 'helper_disabled', {LABEL:asm.assemble([('returnvoid',)])}
    changes=[(4,'pushbyte',30,'wrong_code'),(5,'pushfalse',None,'exclude_shared_slots'),
             (21,'pushbyte',1,'wrong_reserved_arg'),(22,'ifeq',None,'reverse_arg_filter'),
             (24,'getlocal_2',None,'effective_reads_overflow'),(26,'pushbyte',4,'effective_loses_layers'),
             (28,'add',None,'effective_product_removed'),(29,'getlocal_1',None,'overflow_reads_effective'),
             (31,'pushbyte',1,'overflow_reads_effective_value'),(33,'add',None,'overflow_product_removed'),
             (35,'pushbyte',0,'overflow_wrong_layers'),(37,'add',None,'overflow_layers_removed'),
             (38,'subtract',None,'mix_subtracts_overflow'),(39,'subtract',None,'rows_subtract'),
             (45,'ifgt',None,'loop_skipped'),(48,'ifne',None,'skip_nonzero'),
             (55,'multiply',None,'denominator_multiplies'),(57,'pushfalse',None,'forbid_fever_extension'),
             (58,'pushbyte',1,'lose_percent_mode')]
    for index,opcode,arg,name in changes:
        out=copy.deepcopy(code); old=out[index]
        if opcode.startswith('if'):
            old.op=asm.OPCODES[opcode] if hasattr(asm,'OPCODES') else asm.assemble([(opcode,'E'),('label','E'),('returnvoid',)])[0].op
        else:
            replacement=asm.assemble([(opcode,) if arg is None else (opcode,arg)])[0]
            out[index]=replacement
        yield name,{LABEL:out}
