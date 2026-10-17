"""Verify every original raw method-body record and export final P-code."""
import json
import os
import re
from types import SimpleNamespace

from build_common import ROOT, PATCH, JAVA, FFDEC, environment, load, run, write_json


def body_bytes(s, body):
    w = s.m.abcfmt.W()
    for value in body[:5]:
        w.u30(value)
    w.u30(len(body[5]))
    w.raw(body[5])
    w.u30(len(body[6]))
    for exception in body[6]:
        for value in exception:
            w.u30(value)
    w.u30(len(body[7]))
    for trait in body[7]:
        s.m.abcfmt.write_trait(w, trait)
    return w.out()


def inventory(s, tags):
    result = {}
    for tag in tags:
        if tag[0] != 82:
            continue
        name = tag[2][4:-1].decode()
        key = name
        occurrence = 1
        while key in result:
            occurrence += 1
            key = name + '#' + str(occurrence)
        records = [body_bytes(s, body) for body in tag[3].bodies]
        # Body records are the final ABC section. Prove these are actual raw
        # source bytes, including all U30 spellings, not only equal objects.
        assert tag[4].endswith(b''.join(records)), ('noncanonical body records', key)
        result[key] = (tag, records)
    return result


def export(s, name, abc, index, output):
    v = s.m.View(SimpleNamespace(abc=abc), s.m.asm)
    labels = [label for label, ids in v.by_label.items() if index in ids]
    body = abc.bodies[index]
    code = body[5]
    rows = s.m.asm.decode(code)
    normalized, exceptions = v.normalized(index)
    _, offsets = s.m.asm.encode(rows)
    label = labels[0] if labels else f'anonymous-body-{index}'
    filename = re.sub(r'[^A-Za-z0-9_.-]+', '_', name + '--' + label) + '.pcode.txt'
    path = output / filename
    lines = [
        '# 最终 v34 逐方法 P-code；来源 v34.swf（非整类回编）',
        f'# DoABC2: {name}; label: {label}; body: {index}; method: {body[0]}',
        f'# code SHA-256: {s.sha(code)}; header: {body[1:5]}',
        '# 分支目标为指令下标；操作数按实际常量池符号解析。',
    ]
    for i, (ins, norm, offset) in enumerate(zip(rows, normalized, offsets)):
        line = f'#{i:04d} ofs{offset:04x}: {ins.name} {norm[1]!r}'
        if ins.target is not None:
            line += f' -> #{ins.target}'
        if ins.cases is not None:
            line += f' default=#{ins.default} cases={ins.cases}'
        lines.append(line)
    lines.append('# exceptions: ' + repr(exceptions))
    path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return {'abc': name, 'method': label, 'body': index, 'code_sha256': s.sha(code),
            'method_body_sha256': s.sha(body_bytes(s, body)), 'path': path.name}


def main():
    os.environ.update(environment())
    s = load('v34_verifier_support', PATCH / 'startup-cache/build_swf.py')
    source, candidate = ROOT / 'inputs/v33.swf', ROOT / 'v34.swf'
    ver0, header0, tags0 = s.parts(source)
    ver1, header1, tags1 = s.parts(candidate)
    assert (ver0, header0) == (ver1, header1)
    before, after = inventory(s, tags0), inventory(s, tags1)
    expected = json.loads((PATCH / 'client-comprehensive/r4-expected.json').read_text('utf-8'))
    helpers = set(after) - set(before)
    assert helpers == set(expected['helpers'])
    assert set(before) <= set(after)
    assert [t[1] for t in tags0 if t[0] != 82] == [t[1] for t in tags1 if t[0] != 82]
    assert [t[2] for t in tags0 if t[0] == 82] == [
        t[2] for t in tags1 if t[0] == 82 and t[2][4:-1].decode() in before]
    changed, details, count, unchanged = [], [], 0, 0
    pcode = ROOT / 'final-pcode'
    pcode.mkdir(exist_ok=True)
    for name, (tag0, raw0) in before.items():
        tag1, raw1 = after[name]
        a, b = tag0[3], tag1[3]
        if name != 'boot_ffc6':
            assert tag0[1] == tag1[1], ('unrelated original ABC changed', name)
        assert (a.major, a.minor, len(raw0)) == (b.major, b.minor, len(raw1))
        count += len(raw0)
        for field in ('methods', 'instances', 'classes', 'scripts', 'metadata'):
            assert s.m.freeze(getattr(a, field)) == s.m.freeze(getattr(b, field)), (name, field)
        for field in ('strings', 'ints', 'uints', 'doubles', 'namespaces', 'ns_sets', 'multinames'):
            old = getattr(a, field)
            assert s.m.freeze(old) == s.m.freeze(getattr(b, field)[:len(old)]), (name, field)
        for index, (left, right) in enumerate(zip(raw0, raw1)):
            if left == right:
                unchanged += 1
                continue
            key = name + ':' + str(index)
            changed.append(key)
            assert a.bodies[index][0] == b.bodies[index][0]
            assert s.m.freeze(a.bodies[index][7]) == s.m.freeze(b.bodies[index][7])
            detail = export(s, name, b, index, pcode)
            detail['check'] = s.m.check_body(b.bodies[index], b)
            details.append(detail)
    assert count == 96733 and unchanged == 96686
    assert set(changed) == set(expected['changed_methods']), changed
    helper_rows = []
    for name in sorted(helpers):
        abc = after[name][0][3]
        assert (abc.minor, abc.major) == (16, 46)
        for index, body in enumerate(abc.bodies):
            s.m.check_body(body, abc)
            helper_rows.append(export(s, name, abc, index, pcode))
    assert len(helper_rows) == 102
    work = ROOT / 'verification/independent-ffdec'
    classes = work / 'classes'
    classes.mkdir(parents=True, exist_ok=True)
    run('ffdec-compile', [JAVA.with_name('javac.exe'), '-cp', FFDEC, '-d', classes,
                         PATCH / 'client-comprehensive/CompareNamedBodies.java'])
    result = run('ffdec-compare', [JAVA, '-Xmx2g', '-cp', str(classes) + ';' + str(FFDEC),
                                  'CompareNamedBodies', source, candidate])
    fields = dict(line.split('=', 1) for line in result.stdout.decode().splitlines() if '=' in line)
    assert int(fields['method_bodies']) == count
    assert set(fields['changed'].split(',')) == set(changed)
    assert set(fields['helpers'].split(',')) == helpers and int(fields['added_bodies']) == 102
    report = {'passed': True, 'baseline_sha256': s.sha(source.read_bytes()),
              'swf_sha256': s.sha(candidate.read_bytes()), 'original_method_bodies': count,
              'raw_method_bodies_byte_identical': unchanged, 'changed_methods': sorted(changed),
              'helpers': sorted(helpers), 'new_helper_bodies': len(helper_rows),
              'original_layout_and_signatures_preserved': True,
              'unrelated_original_abc_tags_byte_identical': len(before) - 1,
              'constant_pool_prefixes_preserved': True, 'non_abc_tags_preserved': True,
              'independent_ffdec_agrees': True, 'details': details}
    write_json(ROOT / 'verification/swf-verification.json', report)
    write_json(pcode / 'manifest.json', details + helper_rows)
    print(json.dumps({key: value for key, value in report.items() if key != 'details'}, indent=2))


if __name__ == '__main__':
    main()
