"""Join the two reviewed closed suffix blocks without changing the assembler."""
import copy
from collections import defaultdict
import asm


def join_shared_suffix(editor):
    label = 'ExBoostWindowView/setupButtons'
    end = len(asm.decode(editor.body(label)[5])) - 1
    groups = defaultdict(list)
    for at, block, policy in editor.insertions[label]:
        groups[at].append((block, policy))
    merged, evidence = [], []
    for at, blocks in sorted(groups.items()):
        if len(blocks) == 1:
            merged.append((at, *blocks[0]))
            continue
        assert at == end and len(blocks) == 2, ('unexpected shared splice', label, at)
        assert all(policy == asm.ENTER for _, policy in blocks)
        combined = []
        for block, _ in blocks:
            offset = len(combined)
            for source in block:
                op = copy.deepcopy(source)
                if op.target is not None:
                    assert 0 <= op.target <= len(block), 'suffix jumps into original code'
                    op.target += offset
                if op.cases is not None:
                    assert all(0 <= target <= len(block) for target in [op.default, *op.cases])
                    op.default += offset
                    op.cases = [target + offset for target in op.cases]
                combined.append(op)
        merged.append((at, combined, asm.ENTER))
        evidence.append({'method': label, 'at': at, 'block_lengths': [len(x[0]) for x in blocks],
                         'order': ['layout', 'navigation'], 'incoming': asm.ENTER})
    editor.insertions[label] = merged
    # All remaining insertion points still have the assembler's unique-anchor contract.
    for method, rows in editor.insertions.items():
        points = [row[0] for row in rows]
        assert len(points) == len(set(points)), (method, points)
    return evidence
