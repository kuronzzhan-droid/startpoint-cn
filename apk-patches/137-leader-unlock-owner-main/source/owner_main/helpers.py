"""OwnerIsMain 专用助手；原生方法快照保留签名语义，不使用共享状态。"""
import copy
import hashlib

import asm
import bodies
from perf2_core import splice_with_exits
from static_check import check_body


def runtime_name(e):
    return next(i for i, m in enumerate(e.abc.multinames) if m and m[0] == 0x1b)


def class_name(e, short):
    return next(e.abc.mn_name(row[0]) for row in e.abc.instances
                if e.abc.mn_name(row[0]).split('::')[-1] == short)


def splice(body, at, source, exits=None, incoming=asm.FORBID):
    raw, exc, _, count = splice_with_exits(body, at, source, exits or {}, incoming)
    result = copy.deepcopy(body)
    result[5:7] = [raw, exc]
    return result, (at, count, incoming)


def clone_method(e, source, name, body, extra_args=()):
    """追加同一既有类的方法，逐指令复用原生体；不替换原生记录。"""
    original = e.body(source)
    signature = e.abc.methods[original[0]]
    cls = class_name(e, source.split('/')[0])
    qname = e.add_method(cls, name, '*', ['*'] * (len(signature[1]) + len(extra_args)),
                        [('getlocal_0',), ('pushscope',), ('returnvoid',)],
                        max(len(signature[1]) + len(extra_args) + 1, body[2]))
    added = e.new_methods[-1]
    target = e.body(added['label'])
    method_index = target[0]
    copied_signature = copy.deepcopy(signature)
    copied_signature[1] += [e.q(arg) for arg in extra_args]
    e.abc.methods[method_index] = copied_signature
    target[:] = copy.deepcopy(body)
    target[0] = method_index
    ins = asm.decode(target[5])
    analysis = [asm.Instruction(0x02) if x.op in (0xef, 0xf0, 0xf1) else x for x in ins]
    metrics = asm.simulate(analysis, target[3], e.abc.multinames)
    target[1] = max(target[1], metrics[0])
    target[2] = max(target[2], asm.block_locals(ins), len(copied_signature[1]) + 1)
    checks = check_body(e.abc, target)
    added.update(sha256=hashlib.sha256(target[5]).hexdigest(), header=target[1:5],
                 static_check=checks, derived_from=source,
                 source_sha256=hashlib.sha256(original[5]).hexdigest())
    return qname


def install_eligibility(e):
    q = e.q
    own = e.add_method(class_name(e, 'BattleCharacterLogic'), 'wfxOwnerMainUnlocked', 'Boolean', ['int'], [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_1',), ('pushshort', 1001), ('pushshort', 1000), ('multiply',),
        ('iflt', 'NO'),
        ('getlocal_1',), ('pushshort', 1007), ('pushshort', 1000), ('multiply',),
        ('ifge', 'NO'),
        ('getlocal_0',), ('callproperty', q('wfxPartyMask'), 0), ('setlocal_2',),
        ('getlocal_2',), ('pushbyte', 1), ('bitand',), ('iffalse', 'NO'),
        ('getlocal_2',), ('pushbyte', 8), ('bitand',), ('iffalse', 'YES'),
        ('getlocal_0',), ('getproperty', q('index')), ('pushbyte', 0), ('ifne', 'NO'),
        ('label', 'YES'), ('pushtrue',), ('returnvalue',),
        ('label', 'NO'), ('pushfalse',), ('returnvalue',),
    ], 3)
    rt = runtime_name(e)
    origin = next(t.name for x in e.abc.instances if e.abc.mn_name(x[0]).endswith('::AbilityPeek')
                  for t in x[6] if e.abc.mn_name(t.name).endswith('::get_originKind'))
    panel = e.add_method(class_name(e, 'AbilityDisabledReasonResolver'), 'wfxOwnAbilityUnlocked', 'Boolean',
                        ['*', 'Boolean', 'int'], [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_2',), ('iffalse', 'NO'),
        ('getlocal_1',), ('callproperty', origin, 0), ('setlocal', 4),
        ('getlocal', 4), ('getproperty', q('index')), ('pushbyte', 0), ('ifne', 'NO'),
        ('getlocal', 4), ('getproperty', q('params')), ('pushbyte', 0),
        ('getproperty', rt), ('setlocal', 4),
        ('getlocal', 4), ('pushbyte', 1), ('iflt', 'NO'),
        ('getlocal', 4), ('pushbyte', 6), ('ifgt', 'NO'),
        ('getlocal_0',), ('getproperty', q('party')), ('setlocal', 4),
        ('getlocal', 4), ('iffalse', 'NO'),
        ('getlocal_3',), ('pushbyte', 0), ('iflt', 'NO'),
        ('getlocal_3',), ('pushbyte', 2), ('ifgt', 'NO'),
        ('getlocal', 4), ('callproperty', q('get_unisonCharacters'), 0),
        ('getlocal_3',), ('getproperty', rt), ('setlocal', 4),
        ('getlocal', 4), ('iffalse', 'NO'),
        ('getlocal', 4), ('getproperty', q('index')), ('pushbyte', 0), ('ifne', 'NO'),
        ('getlocal', 4), ('getproperty', q('params')), ('pushbyte', 0),
        ('getproperty', rt), ('setlocal', 4),
        ('getlocal', 4), ('iffalse', 'NO'),
        ('getlocal', 4), ('pushshort', 1001), ('pushshort', 1000), ('multiply',),
        ('callproperty', own, 1), ('returnvalue',),
        ('label', 'NO'), ('pushfalse',), ('returnvalue',),
    ], 5)
    return own, panel


def install_reason_helpers(e):
    source = 'AbilityDisabledReasonResolver/resolvePrecondition'
    body = copy.deepcopy(e.body(source))
    body[2] = 15
    # kind11 is only skipped within the native preconditions array.
    body, _ = splice(body, 53, [
        ('getlocal', 14), ('iffalse', 'ORIGINAL'),
        ('getlocal', 11), ('getproperty', e.q('index')), ('pushbyte', 11),
        ('ifeq', 'NEXT'),
    ], {'ORIGINAL': 53, 'NEXT': 126})
    body, _ = splice(body, 2, [('getlocal', 6), ('setlocal', 14)])
    pre = clone_method(e, source, 'wfxResolveOwnPrecondition', body, ['Boolean'])
    source = 'AbilityDisabledReasonResolver/resolve'
    body = copy.deepcopy(e.body(source))
    body[2] = 13
    ins = asm.decode(body[5])
    for at in (75, 152):
        assert ins[at].name == 'callpropvoid' and ins[at].args == [e.q('resolvePrecondition'), 5]
        ins[at].args = [pre, 6]
    body[5] = asm.encode(ins)[0]
    for at in (152, 75):
        body, _ = splice(body, at, [('getlocal', 12)])
    body, _ = splice(body, 2, [('getlocal', 5), ('setlocal', 12)])
    return clone_method(e, source, 'wfxResolveOwnAbility', body, ['Boolean'])
