"""Exactly two existing bodies; insert-only, with no new classes."""
import asm
from . import bridge, clone, slots
from .common import Code

TARGETS = ('BattleContinuationData/bothbossNext', 'SquadImpl/setContinuationData')


def build(editor):
    c = Code(editor)
    clone.build(c)
    slots.build(c)
    bridge.build(c)
    # Preserve the exact native return value, original locals and instructions.
    ins = asm.decode(editor.body(TARGETS[0])[5])
    returns = [i for i, x in enumerate(ins) if x.name == 'returnvalue']
    assert returns == [len(ins) - 1]
    editor.insert(TARGETS[0], returns[0], [
        ('dup',), ('getlocal_3',), c.helper('wfxStageCapture', 1, void=True)])
    ins = asm.decode(editor.body(TARGETS[1])[5])
    returns = [i for i, x in enumerate(ins) if x.name == 'returnvoid']
    assert returns == [len(ins) - 1]
    editor.insert(TARGETS[1], returns[0], [
        ('getlocal_0',), ('getlocal_1',), c.helper('wfxStageApply', 1, void=True)])
    return {'scope': 'bothboss live continuation only',
            'storage': 'weak Dictionary keyed by native continuation object',
            'state': 'members, primary squad shared slot, invisible children',
            'excluded': 'enemies, summons, fields, quest-initial and enemy-trial state'}
