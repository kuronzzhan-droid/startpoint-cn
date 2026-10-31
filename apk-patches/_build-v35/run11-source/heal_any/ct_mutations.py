"""CT 精确局部变异：静态有效且必须由业务断言检出，异常不算检出。"""
import copy
import asm
import bodies
from static_check import check_body
from .ct_cases import suite, mixed_suite
from .ct_parity import compare
from .cases import TABLE
from .mutations import clear

RECORD = 'MemberImpl/wfxHealAnyCTRecord'
QUEUE = 'MemberImpl$/wfxHealAnyCTQueue'
TICK = 'MemberImpl$/wfxHealAnyCTTick'


def matches(abc, instruction, specification):
    name, *args = specification
    if name == 'number':
        values = {'pushbyte': lambda n: n if n < 128 else n - 256,
                  'pushshort': lambda n: n, 'pushint': lambda n: abc.ints[n],
                  'pushuint': lambda n: abc.uints[n], 'pushdouble': lambda n: abc.doubles[n]}
        return instruction.name in values and values[instruction.name](instruction.args[0]) == args[0]
    return instruction.name == name and (not args or instruction.args == args)


def edit(abc, label, pattern, offset, replacement):
    body = abc.bodies[bodies.resolve(abc, label)]
    code = asm.decode(body[5])
    sites = [at for at in range(len(code) - len(pattern) + 1)
             if all(matches(abc, ins, spec) for ins, spec in zip(code[at:], pattern))]
    assert len(sites) == 1, ('ct-mutant-anchor-not-unique', label, pattern, sites)
    target = code[sites[0] + offset]
    target.op = asm.MNEMONICS[replacement[0]]
    target.args = list(replacement[1:])
    changed = copy.deepcopy(body)
    changed[5] = asm.encode(code)[0]
    return changed


def candidates(before, after):
    for label in ('MemberImpl/wfxHealAnyDamage', 'MemberImpl$/wfxHealDamageTick'):
        yield label, 'restore-pre-ct-hook', copy.deepcopy(before.bodies[bodies.resolve(before, label)]), False
    specs = [
        (RECORD, 'ct-seconds-divisor-1000-to-100',
         [('number', 1000), ('divide',)], 0, ('pushbyte', 100)),
        (RECORD, 'ct-normalized-step-modulus-1000-to-100',
         [('number', 1000), ('modulo',)], 0, ('pushbyte', 100)),
        (RECORD, 'logic-frame-rate-60-to-30',
         [('getlocal', 5), ('number', 60), ('multiply',)], 1, ('pushbyte', 30)),
        (RECORD, 'minimum-ct-clamp-30-to-61',
         [('number', 30), ('getlocal', 5), ('number', 60)], 0, ('pushbyte', 61)),
        (RECORD, 'aggregation-window-30-to-29',
         [('getlocal', 9), ('number', 30), ('add',)], 1, ('pushbyte', 29)),
        (RECORD, 'ct-classification-modulus-10-to-9',
         [('number', 10), ('modulo',)], 0, ('pushbyte', 9)),
        (RECORD, 'effective-tier-threshold-100-to-99',
         [('getlocal_2',), ('number', 100), ('multiply',)], 1, ('pushbyte', 99)),
        (RECORD, 'overflow-tier-threshold-100-to-99',
         [('getlocal_3',), ('number', 100), ('multiply',)], 1, ('pushbyte', 99)),
        (RECORD, 'cooldown-blocks-expiry-frame',
         [('getlocal', 9), ('getlocal', 8), ('number', 2), ('getproperty',), ('iflt',)],
         4, ('ifle',)),
        (QUEUE, 'holder-identity-inverted',
         [('getlocal', 4), ('number', 0), ('getproperty',), ('getlocal_1',), ('ifstricteq',)],
         4, ('ifstrictne',)),
        (TICK, 'aggregation-emits-one-frame-late',
         [('getlocal_3',), ('getlocal', 5), ('number', 1), ('getproperty',), ('iflt',)],
         4, ('ifle',)),
        (TICK, 'cooldown-origin-fixed-due30-not-actual-emission',
         [('getlocal', 5), ('number', 2), ('getlocal_3',), ('getlocal', 5), ('number', 3)],
         2, ('pushbyte', 30)),
    ]
    for label, name, pattern, offset, replacement in specs:
        yield label, name, edit(after, label, pattern, offset, replacement), False
    yield RECORD, 'no-ct-claims-handled-and-skips-original', edit(after, RECORD,
            [('pushfalse',), ('returnvalue',)], 0, ('pushtrue',)), True
    names = {name: next(i for i in range(len(after.multinames)) if after.mn_name(i) == name)
             for name in ('floor', 'max', 'min')}
    pattern = [('callproperty', names['floor'], 1), ('callproperty', names['max'], 2),
               ('setlocal', 5), ('inclocal_i', 6)]
    yield RECORD, 'mixed-ct-maximum-to-minimum', edit(after, RECORD, pattern, 1,
            ('callproperty', names['min'], 2)), False


def run(before, after):
    rows = []
    for label, name, changed, old_path in candidates(before, after):
        index = bodies.resolve(after, label)
        original = after.bodies[index]
        changed[0] = original[0]
        check_body(after, changed)
        try:
            after.bodies[index] = changed
            clear(after)
            if old_path:
                compare(before, after, TABLE, (34, 35), [(0, 5, {'origin': -1})])
            elif name == 'mixed-ct-maximum-to-minimum':
                mixed_suite(after)
            else:
                suite(after)
        except AssertionError as exc:
            rows.append({'method': label, 'mutation': name, 'static_valid': True,
                         'status': 'killed', 'business_assertion': True,
                         'failure': str(exc)[:350]})
        except Exception as exc:
            rows.append({'method': label, 'mutation': name, 'static_valid': True,
                         'status': 'invalid-runtime-failure', 'business_assertion': False,
                         'failure': type(exc).__name__ + ': ' + str(exc)[:350]})
        else:
            rows.append({'method': label, 'mutation': name, 'static_valid': True,
                         'status': 'survived', 'business_assertion': False})
        finally:
            after.bodies[index] = original
            clear(after)
    assert all(row['status'] == 'killed' and row['business_assertion'] for row in rows), rows
    suite(after)
    return rows
