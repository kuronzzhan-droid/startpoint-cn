"""Guard the three remaining equipment-only casts used by instance rows."""
import asm
from bootstrap import sha
from c2_common import get

OWNED = 'pinball.common.data.item::OwnedEquipmentPeek'


def queue_rows(editor):
    result = {}
    for label, expected, row in [
        ('EquipmentListTableView/run', 70, [('getlocal_3',)]),
        ('EquipmentListTableItemView/registerButton', 6,
         [('getlocal_0',), ('getproperty', editor.q('item'))]),
        ('EquipmentListTableItemView/get_equipmentId', 5,
         [('getlocal_0',), ('getproperty', editor.q('item'))]),
    ]:
        body = editor.body(label)
        ops = asm.decode(body[5])
        sites = [i for i, op in enumerate(ops) if op.name == 'coerce'
                 and editor.abc.mn_name(op.args[0]) == OWNED]
        assert sites == [expected], (label, sites)
        assert ops[expected - 1].name == 'getproperty'
        assert editor.abc.mn_name(ops[expected - 1].args[0]) == 'equipment'
        assert ops[expected + 1].name == 'getproperty'
        assert editor.abc.mn_name(ops[expected + 1].args[0]) == 'id'
        assert body[6:] == [[], []]
        block = asm.assemble([*row, *get(editor, 'wfxRiven'), ('iftrue', 'END')])
        # asm.splice rebases block targets relative to the insertion point.
        # END + 1 skips only the original coerce, preserving its input object.
        # The subsequent public id read accepts both DTOs and owned equipment.
        block[-1].target = len(block) + 1
        editor.locks[label] = {'sha': sha(body[5]), 'header': list(body[1:5])}
        editor.insertions.setdefault(label, []).append((expected, block, asm.ENTER))
        result[label] = {'instruction': expected, 'guard': 'row.wfxRiven',
                         'skipped_instructions': 1, 'skipped_type': OWNED,
                         'ordinary_equipment_cast_preserved': True}
    return result
