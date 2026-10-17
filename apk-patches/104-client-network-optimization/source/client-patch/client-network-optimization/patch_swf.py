"""Restore per-request budgets and replace frame-counted HTTP deadlines with AIR timers."""
import argparse
import copy
import importlib.util
import json
import os
import struct
import subprocess
import zlib
from pathlib import Path

import importlib.util as _quiet_importlib
import sys as _quiet_sys
_quiet_spec = _quiet_importlib.spec_from_file_location("starpoint_quiet_process", Path(__file__).resolve().parents[1] / 'quiet_process.py')
quiet = _quiet_importlib.module_from_spec(_quiet_spec)
_quiet_sys.modules[_quiet_spec.name] = quiet
_quiet_spec.loader.exec_module(quiet)
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('network_swf_base', HERE.parent / 'startup-cache/build_swf.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
SDK = Path(os.environ.get('STARPOINT_AIR_SDK', 'AIRSDK_51.2.1.5'))
JAVA = Path(os.environ.get('STARPOINT_JAVA', 'java'))
HELPER_NAMES = (b'cn/optimize/network/RequestTimer', b'cn/optimize/network/NetworkBudget')
TARGETS = {
    'pinball.context.remote::RequestQueue/startRequest|1': '4de33b3c537025ca520765e5ef9a1ed4667dc2e308a1ae3884cd157738b4f233',
    'pinball.context.remote::RequestQueue/requestErrorHandler|1': 'fafc9831a54ba35aff3575e5ce1e1f90502a599a36a2829e3993fcabc54bc019',
    'pinball.context.remote::RemoteEventListenerManager/addEventListeners|1': '956a4e75158c8bcbf7a038e7c93f6a0908073bb55da68ada81dd33b34bc60fe4',
    'pinball.context.remote::RemoteEventListenerManager/removeListeners|1': 'fc6c0b8323222970b210f36c1f1c073f61835b7d0fabff4e9149974e48658178',
}

def view(a):
    return s.m.View(SimpleNamespace(abc=a), s.m.asm)

def q(a, namespace, name):
    v = view(a)
    wanted = (7, (22, namespace), name)
    for i in range(1, len(a.multinames)):
        if v.mn(i) == wanted:
            return i
    pool = s.PoolEditor(a)
    ns = next((i for i, x in enumerate(a.namespaces) if i and x[0] == 22 and a.s(x[1]) == namespace), None)
    if ns is None:
        a.namespaces.append((22, pool.string(namespace)))
        ns = len(a.namespaces) - 1
    a.multinames.append((7, ns, pool.string(name)))
    return len(a.multinames) - 1

def start_block(a):
    helper = q(a, 'cn.optimize.network', 'NetworkBudget')
    return s.m.asm.assemble([
        ('getlex', helper), ('getlocal_0',), ('getlocal_2',), ('getlocal_3',),
        ('callproperty', q(a, '', 'prepare'), 3), ('convert_i',), ('setlocal_3',),
        ('getlex', helper), ('getlocal_0',), ('getlocal_1',), ('getlocal_2',), ('getlocal_3',),
        ('callproperty', q(a, '', 'allowSend'), 4), ('iftrue', 'continue'), ('returnvoid',),
        ('label', 'continue'),
    ])

def error_block(a):
    return s.m.asm.assemble([
        ('getlocal_0',), ('getlex', q(a, 'cn.optimize.network', 'NetworkBudget')),
        ('getlocal_0',), ('getlocal_3',), ('callproperty', q(a, '', 'remaining'), 2),
        ('setproperty', q(a, '', 'timeLeft')),
    ])

def patch_main(a):
    before = copy.deepcopy(a)
    v = view(a)
    changed = []
    for label, expected in TARGETS.items():
        bi, = v.by_label[label]
        body = a.bodies[bi]
        assert s.sha(body[5]) == expected, 'unsupported target body: ' + label
        old = bytes(body[5])
        if label.endswith('/startRequest|1'):
            rows = s.m.asm.decode(old)
            assert rows[11].target == 13 and rows[12].op == 0x47
            body[5], body[6], _, placed = s.m.asm.splice_many(body, [(13, start_block(a), s.m.asm.ENTER)])
            assert s.m.asm.unsplice_many(body[5], placed) == old
        elif label.endswith('/requestErrorHandler|1'):
            body[5], body[6], _, placed = s.m.asm.splice_many(body, [(24, error_block(a), s.m.asm.ENTER)])
            assert s.m.asm.unsplice_many(body[5], placed) == old
        elif label.endswith('/removeListeners|1'):
            rows = s.m.asm.decode(old)
            hits = [r for r in rows if r.op == 0x80 and v.mn(r.args[0]) == (7, (22, 'pinball.common.task'), 'Delay')]
            assert len(hits) == 1
            hits[0].args[0] = q(a, 'cn.optimize.network', 'RequestTimer')
            assert not body[6]
            body[5] = s.m.asm.encode(rows)[0]
        else:
            rows = s.m.asm.decode(old)
            assert not body[6]
            assert len(rows) == 102 and all(x.target is None and x.cases is None for x in rows[:50])
            tail = s.m.asm.assemble([('getlex', q(a, 'cn.optimize.network', 'NetworkBudget')),
                                    ('getlocal_0',), ('callpropvoid', q(a, '', 'install'), 1), ('returnvoid',)])
            body[5] = s.m.asm.encode(rows[:50] + tail)[0]
        check = s.m.check_body(body, a)
        body[1] = max(body[1], check['max_stack'])
        changed.append({'label': label, 'body': bi, 'original_code_sha256': expected,
                        'code_sha256': s.sha(body[5]), 'check': check})
    indices = {x['body'] for x in changed}
    for i, b in enumerate(a.bodies):
        if i not in indices:
            assert s.m.freeze(b) == s.m.freeze(before.bodies[i])
    for field in ('methods', 'instances', 'classes', 'scripts', 'metadata'):
        assert s.m.freeze(getattr(a, field)) == s.m.freeze(getattr(before, field)), field
    for field in ('strings', 'ints', 'uints', 'doubles', 'namespaces', 'ns_sets', 'multinames'):
        original = getattr(before, field)
        assert s.m.freeze(getattr(a, field)[:len(original)]) == s.m.freeze(original), field
    return changed

def compile_helper(work):
    work.mkdir(parents=True, exist_ok=False)
    command = [JAVA, '-Dflexlib=' + str(SDK / 'frameworks'), '-Xmx512m', '-jar', SDK / 'lib/compc-cli.jar',
               '+configname=air', '-swf-version=32', '-target-player=21.0', '-debug=false', '-compress=false',
               '-compiler.float=false', '-compiler.source-path=' + str(HERE / 'src'),
               '-include-classes=cn.optimize.network.NetworkBudget,cn.optimize.network.RequestTimer',
               '-output=' + str(work / 'helper.swc')]
    result = quiet.run([str(x) for x in command], capture_output=True, timeout=120)
    (work / 'compile.log').write_bytes(result.stdout + result.stderr)
    assert result.returncode == 0, 'helper compilation: ' + str(work / 'compile.log')
    import zipfile
    with zipfile.ZipFile(work / 'helper.swc') as archive:
        (work / 'helper.swf').write_bytes(archive.read('library.swf'))
    helpers = [t for t in s.parts(work / 'helper.swf')[2] if t[0] == 82]
    assert tuple(t[2][4:-1] for t in helpers) == HELPER_NAMES
    for t in helpers:
        helper = t[3]
        assert helper.major == 46
        assert all(helper.mn_name(i[0]).startswith('cn.optimize.network::') for i in helper.instances)
    return helpers

def patch(source, output):
    assert not output.exists(), 'refuse to replace an existing SWF'
    output.parent.mkdir(parents=True, exist_ok=True)
    version, header, tags = s.parts(source)
    assert not any(t[0] == 82 and t[2][4:-1] in HELPER_NAMES for t in tags), 'helper already installed'
    main, = [t for t in tags if t[0] == 82 and t[2][4:-1] == b'boot_ffc6']
    changes = patch_main(main[3])
    helpers = compile_helper(output.parent / (output.stem + '-compile'))
    payload = main[2] + s.serialize(main[3], main[4])
    main[1] = struct.pack('<HI', (82 << 6) | 63, len(payload)) + payload
    extra = b''.join(t[1] for t in helpers)
    raw = header + b''.join((extra if t is main else b'') + t[1] for t in tags)
    output.write_bytes(b'CWS' + bytes([version]) + struct.pack('<I', len(raw) + 8) + zlib.compress(raw))
    final = s.parts(output)[2]
    old_tags = [t[1] for t in tags]
    without_helper = [t[1] for t in final if not (t[0] == 82 and t[2][4:-1] in HELPER_NAMES)]
    assert old_tags == without_helper
    report = {'input_swf_sha256': s.sha(source.read_bytes()), 'swf_sha256': s.sha(output.read_bytes()),
              'changes': changes, 'helper_abcs': [n.decode() for n in HELPER_NAMES],
              'added_method_bodies': sum(len(t[3].bodies) for t in helpers),
              'original_traits_and_method_signatures_preserved': True,
              'other_input_tags_preserved': True, 'no_persistence_or_admission_protocol_change': True}
    output.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('input', type=Path)
    ap.add_argument('output', type=Path)
    args = ap.parse_args()
    print(json.dumps(patch(args.input, args.output), indent=2))
