"""C17 native EX presentation forks, inserted inside existing method bodies."""
import copy
import asm
import bodies
from bootstrap import P13, P13_SHA, require_hash, sha
from c2_common import DYNAMIC, MODE
from swfabc import SwfAbc

CLASSES = {
    'ExBoostDrawConfirmDialog', 'ExBoostDrawConfirmDialogView',
    'ExBoostSelectDialog', 'ExBoostSelectDialogView',
    'ExBoostInformationAbilityView', 'ExBoostWindowView',
    'ExBoostDetailView', 'ExBoostCutin', 'ExBoostCutinView', 'ExpodSceneView',
}


def mode_guard(e, local, label):
    """No getter is called while loadedData is None; scratch never aliases args."""
    g = lambda: ('getlocal', local)
    put = ('setlocal', local)
    gp = lambda name: ('getproperty', e.q(name))
    if label == 'ExBoostDrawConfirmDialogView/run':
        # This dialog already owns an immutable DTO; closing the scene must not
        # reclassify a late Riven confirmation as a character confirmation.
        return asm.assemble([('getlocal_0',), gp('values'), put, g(),
            ('iffalse', 'official'), g(), e.string('mode'),
            ('getproperty', DYNAMIC), e.string(MODE), ('ifeq', 'END'),
            ('label', 'official')])
    code = [('getlex', e.q('PinballClientMain')), gp('top'), put, g(),
            ('iffalse', 'official')]
    for field in ('logic', 'globalLogic', 'logicStatus', 'loadedData'):
        code += [g(), gp(field), put, g(), ('iffalse', 'official')]
    code += [g(), gp('index'), ('pushbyte', 0), ('ifne', 'official'),
             g(), gp('params'), ('pushbyte', 0), ('getproperty', DYNAMIC), put,
             g(), ('iffalse', 'official'), g(), e.string(MODE),
             ('getproperty', DYNAMIC), put, g(), ('iffalse', 'official'),
             g(), e.string('mode'), ('getproperty', DYNAMIC), e.string(MODE),
             ('ifeq', 'END'), ('label', 'official')]
    return asm.assemble(code)


def shift(block, delta):
    result = copy.deepcopy(block)
    for op in result:
        if op.target is not None: op.target += delta
        if op.cases is not None:
            op.default += delta
            op.cases = [target + delta for target in op.cases]
    return result


def apply(editor):
    require_hash(P13, P13_SHA)
    native = SwfAbc(P13).abc
    labels = bodies.label_map(editor.abc)
    evidence = {}
    for index, label in labels.items():
        if label.split('/')[0] not in CLASSES:
            continue
        original, current = native.bodies[index], editor.abc.bodies[index]
        if original[5] == current[5] and label not in editor.insertions:
            continue
        assert not original[6] and not original[7], label
        assert original[0] == current[0]
        ops = asm.decode(original[5]); inherited = asm.decode(current[5])
        assert [op.name for op in ops[:2]] == ['getlocal_0', 'pushscope'], label
        assert [op.name for op in inherited[:2]] == ['getlocal_0', 'pushscope'], label
        # Confirmation initializes values from its peek before the DTO can be
        # classified. Execute that native prefix exactly once before the fork.
        at = 8 if label == 'ExBoostDrawConfirmDialogView/run' else 2
        prefix_bytes = asm.encode(ops[:at])[0]
        assert asm.encode(inherited[:at])[0] == prefix_bytes, label
        # A native prefix already entered the same scope; retain every following
        # byte, including lookupswitch and dead branches. No new runtime method.
        native_block = shift(ops[at:], -at)
        native_bytes = asm.encode(native_block)[0]
        assert native_bytes == original[5][len(prefix_bytes):], label
        guard = mode_guard(editor, current[2], label)
        guard[-1].target = len(guard) + len(native_block)
        block = guard + shift(native_block, len(guard))
        editor.locks.setdefault(label, {'sha': sha(current[5]), 'header': list(current[1:5])})
        # First at a shared anchor so ordinary mode cannot enter cost/layout code.
        editor.insertions.setdefault(label, []).insert(0, (at, block, asm.ENTER))
        evidence[label] = dict(native_sha256=sha(original[5]),
            native_suffix_sha256=sha(native_bytes), native_suffix_size=len(native_bytes),
            guard_instruction_count=len(guard), native_instruction_count=len(native_block),
            fork_instruction=at,
            native_start_instruction=at+len(guard), native_end_instruction=at+len(block),
            native_prefix_size=len(prefix_bytes), ordinary_getter_calls=0,
            source='p13', safe_none=True, riven_path='unchanged C16 plus C17 cost splices')
    assert len(evidence) >= 19, len(evidence)
    return dict(methods=evidence, modified_method_count=len(evidence),
                policy='Non-Riven presentation executes p13 byte-exact native suffix; Riven executes inherited C16 path.',
                new_methods=0, new_traits=0)
