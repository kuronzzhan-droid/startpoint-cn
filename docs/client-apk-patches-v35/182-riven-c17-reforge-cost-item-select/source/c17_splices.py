"""Join the reviewed native fork and Riven cost prefix at one shared anchor."""
import copy
import asm


def join(editor):
    label = 'ExBoostDrawConfirmDialog/getValuesForView'
    rows = editor.insertions[label]
    assert len(rows) == 2 and all(at == 2 and policy == asm.ENTER for at, _, policy in rows)
    combined = []
    sizes = []
    for _, block, _ in rows:
        sizes.append(len(block))
        offset = len(combined)
        for source in block:
            op = copy.deepcopy(source)
            if op.target is not None:
                assert 0 <= op.target <= len(block)
                op.target += offset
            if op.cases is not None:
                assert all(0 <= target <= len(block) for target in [op.default, *op.cases])
                op.default += offset
                op.cases = [target + offset for target in op.cases]
            combined.append(op)
    editor.insertions[label] = [(2, combined, asm.ENTER)]
    for name, additions in editor.insertions.items():
        points = [row[0] for row in additions]
        assert len(points) == len(set(points)), ('Unreviewed shared splice', name, points)
    return {'method': label, 'at': 2, 'order': ['native mode fork', 'Riven selected cost'],
            'block_lengths': sizes, 'incoming': asm.ENTER}
