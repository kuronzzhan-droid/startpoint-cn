"""核心新增方法的实际ABC结构检查，不执行外部stub。"""
import bootstrap
from bootstrap import BASE
from framework import Editor
import fp_context
import fp_buffer
import fp_sample

e = Editor(BASE)
fp_context.add_slots(e)
for module in (fp_context, fp_buffer, fp_sample):
    print(module.__name__, module.build(e))
e.apply()
print('core generated/static pass', len(e.new_methods))
