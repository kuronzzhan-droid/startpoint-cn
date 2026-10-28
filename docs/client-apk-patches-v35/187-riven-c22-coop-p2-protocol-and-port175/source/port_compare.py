"""Compare full instruction streams with constant-pool references resolved."""
import json
from bootstrap import ROOT, WORKSPACE, sha
from common import describe
from swfabc import SwfAbc
import asm
import bodies

HISTORICAL_CATALOG_ID = 'riven-multi-v1-0a3495b4b3edff692b8ddf9265657a63'


def historical(stage):
    name = 'build' if stage == 1 else ('build-c19-revised' if stage == 19 else f'build-c{stage}')
    paths = list((WORKSPACE / name / 'swf').glob('*.swf'))
    assert len(paths) == 1, (stage, paths)
    return paths[0]


def canonical(abc, body):
    ops = asm.decode(body[5])
    _, offsets = asm.encode(ops)
    pc = {offset: i for i, offset in enumerate(offsets)}
    pc[len(body[5])] = len(ops)
    exceptions = [[pc[x[0]], pc[x[1]], pc[x[2]], *x[3:]] for x in body[6]]
    return {'header': body[1:5], 'ops': [describe(abc, op) for op in ops],
            'exceptions': exceptions, 'traits': [trait(abc, t) for t in body[7]]}


def trait(abc, t):
    # Trait objects have identity equality; compare their resolved content.
    data = list(t.data)
    if data[0] == 'slot':
        data[2] = abc.mn_name(data[2]) if data[2] else '*'
    return [abc.mn_name(t.name), t.kind, t.attr, data, list(t.metadata)]


def compare_methods(editor, reference, labels, stage):
    rows = []
    for label in sorted(labels):
        actual = canonical(editor.abc, editor.body(label))
        expected = canonical(reference.abc, reference.abc.bodies[bodies.resolve(reference.abc, label)])
        if stage == 22:
            # P2 catalog is a build parameter: the only allowed difference from
            # the historical C22 build is the catalog-id string literal.
            from c22_catalog import CATALOG_ID
            old = repr(HISTORICAL_CATALOG_ID)
            expected['ops'] = [op.replace(old, repr(CATALOG_ID)) if op.startswith('pushstring') else op
                               for op in expected['ops']]
        if actual != expected:
            from bootstrap import write_json
            write_json(ROOT / f'audit/replay/c{stage:02d}-mismatch.json',
                       {'method': label, 'expected': expected, 'actual': actual})
            raise AssertionError(f'C{stage} semantic mismatch: {label}')
        rows.append({'method': label, 'instruction_count': len(actual['ops']),
                     'resolved_instruction_stream_and_header_equal': True,
                     'canonical_sha256': sha(json.dumps(actual, sort_keys=True).encode())})
    return rows


def adapt_consumer_lock(editor):
    """Re-lock only after proving full C21 equivalence under pool relocation."""
    import c22_consumer as module
    reference = SwfAbc(historical(21))
    compare_methods(editor, reference, [module.TARGET], 21)
    previous = module.BASE_SHA
    module.BASE_SHA = sha(editor.body(module.TARGET)[5])
    return {'method': module.TARGET, 'historical_lock': previous,
            'relocated_lock': module.BASE_SHA, 'full_semantic_equality_checked': True}
