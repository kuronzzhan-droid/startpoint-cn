"""前 1200 帧固定 30；之后原样进入 v35s 的耗时和预算自适应。"""
import asm
from fp_transport_codegen import Emit, BATTLE, TRUE, FALSE

TARGETS = ['Battle$/wfxFpBudgetGrid', 'Battle$/wfxFpAdaptGrid']


def fixed_early(z):
    # 只写诊断 state；currentFrame 是已有字段，禁止游戏 RNG 或懒创建调用。
    c = [('label', 'TRY')] + z.guard('OUT')
    c += z.g(2, 'currentFrame') + [('setlocal', 3)]
    c += z.l(3) + z.n(0) + [('iflt', 'OUT')]
    c += z.l(3) + z.n(1200) + [('ifgt', 'OUT')]
    c += z.set(1, 'sampleInterval', z.n(30))
    c += z.set(1, 'sampleLowCount', z.n(0))
    c += TRUE + [('returnvalue',), ('label', 'OUT')]
    c += FALSE + [('returnvalue',), ('label', 'CATCH'), ('pop',)]
    c += FALSE + [('returnvalue',)]
    z.add('wfxFpFixedEarly', 'Boolean', ['Object', BATTLE], c, 4,
          exceptions=[('TRY', 'CATCH', 'CATCH', 0, 0)])


def build(editor):
    z = Emit(editor)
    fixed_early(z)
    locations = {}
    for label, battle_local in zip(TARGETS, (2, 3)):
        body = editor.body(label)
        instructions = asm.decode(body[5])
        guards = [i for i, op in enumerate(instructions[:-1])
                  if op.name == 'getproperty'
                  and editor.abc.mn_name(op.args[0]) == 'wfxFpEnabled'
                  and instructions[i + 1].name == 'iffalse']
        assert len(guards) == 1, ('unknown enabled guard', label, guards)
        at = guards[0] + 2
        # 所有插入均处于既有 TRY 内；原指令及异常表可逆恢复。
        _, offsets = asm.encode(instructions)
        assert any(start <= offsets[at] < stop for start, stop, *_ in body[6]), label
        code = z.static('wfxFpFixedEarly', z.l(1), z.l(battle_local))
        code += [('iffalse', 'ORIGINAL'), ('returnvoid',), ('label', 'ORIGINAL')]
        editor.insert(label, at, code)
        locations[label] = at
    return dict(fixed_interval=30, inclusive_frames=[0, 1200],
                protected_from=['elapsed_time', 'uplink_budget'],
                after_1200='unchanged v35s absolute 30/60/120/240 grid',
                send_budget_bytes_per_1000ms=20000,
                game_state_writes=False, insertion_inside_original_try=locations)
