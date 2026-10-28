"""Combine explicitly reviewed closed blocks at shared instruction anchors."""
import copy
from collections import defaultdict
import asm

# Populated only when module integration demonstrates a shared anchor.
SHARED = set()


def join_shared_splices(editor):
    evidence = []
    for label, rows in editor.insertions.items():
        groups = defaultdict(list)
        for at, block, policy in rows:
            groups[at].append((block, policy))
        merged = []
        for at, blocks in sorted(groups.items()):
            if len(blocks) == 1:
                merged.append((at, *blocks[0]))
                continue
            assert (label, at) in SHARED, ('unreviewed shared anchor', label, at)
            assert len({policy for _, policy in blocks}) == 1
            combined = []
            for block, _ in blocks:
                offset = len(combined)
                for source in block:
                    op = copy.deepcopy(source)
                    if op.target is not None:
                        assert 0 <= op.target <= len(block), 'shared block branches outside block'
                        op.target += offset
                    if op.cases is not None:
                        assert all(0 <= target <= len(block) for target in [op.default, *op.cases])
                        op.default += offset
                        op.cases = [target + offset for target in op.cases]
                    combined.append(op)
            merged.append((at, combined, blocks[0][1]))
            evidence.append({'method': label, 'at': at,
                             'block_lengths': [len(block) for block, _ in blocks]})
        editor.insertions[label] = merged
    return evidence
