"""复用 run2 通用解释器并补齐真实 O1 所需 AVM2 in；不模拟业务判定。"""
import inspect,sys,types,functools
import bootstrap
sys.path.append(str(bootstrap.ROOT.parent/'run2'))
import party.runtime as previous

source=inspect.getsource(previous)
old='    src=inspect.getsource(avm_interp)'
new='''    src=inspect.getsource(avm_interp)
    src=src.replace("            elif op == 'lookupswitch':", "            elif op == 'in':\\n                obj = stack.pop(); key = stack.pop()\\n                stack.append(key in obj if isinstance(obj, dict) else str(key).isdigit() and 0 <= int(key) < len(obj))\\n            elif op == 'lookupswitch':")'''
assert source.count(old)==1
source=source.replace(old,new)
module=types.ModuleType('materials_avm_runtime')
exec(compile(source,'<run2 generic runtime + AVM2 in>','exec'),module.__dict__)
VM=module.VM
Harness=module.Harness
fallback=VM._lookup


def lookup(obj,key):
    name=str(key).split('::')[-1]
    if isinstance(obj,dict) and key in obj:return obj[key]
    if isinstance(obj,list):
        if name=='sort':return lambda compare:obj.sort(key=functools.cmp_to_key(compare))
        if name=='indexOf':return lambda value:obj.index(value) if value in obj else -1
        if name=='join':return lambda delimiter:delimiter.join(map(str,obj))
    return fallback(obj,key)
VM._lookup=lookup
