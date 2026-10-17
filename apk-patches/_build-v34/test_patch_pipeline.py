"""Exercise fail-closed gates on small R4 helper SWFs, not game acceptance."""
import copy
import json
from pathlib import Path
import struct
import tempfile
import zlib

from build_common import ROOT, PATCH, load, write_json
from patch_pipeline import confined, locked, run_pipeline, sha
from swf_patch_guard import verify_patch


def main():
    directory = ROOT / 'work/patch-pipeline-tests'
    directory.mkdir(exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='test-', dir=directory))
    source = work / 'source.swf'
    source.write_bytes((ROOT / 'work/after-network-compile/helper.swf').read_bytes())
    support = load('pipeline_test_support', PATCH / 'startup-cache/build_swf.py')
    version, header, tags = support.parts(source)
    index = next(i for i, tag in enumerate(tags) if tag[0] == 82)
    name = tags[index][2][4:-1].decode('utf-8')
    body_key = f'{name}:0'
    results = []

    def record(name, action, rejects=False):
        try:
            action()
        except (ValueError, AssertionError) as error:
            if not rejects:
                raise
            results.append({'test': name, 'passed': True, 'rejected': str(error)})
        else:
            if rejects:
                raise AssertionError(f'Expected fail-closed rejection: {name}')
            results.append({'test': name, 'passed': True})

    def altered(name, mutate):
        rows = copy.deepcopy(tags)
        abc = rows[index][3]
        mutate(abc)
        data = rows[index][2] + support.serialize(abc, tags[index][4])
        rows[index][1] = struct.pack('<HI', (82 << 6) | 63, len(data)) + data
        raw = header + b''.join(row[1] for row in rows)
        target = work / (name + '.swf')
        target.write_bytes(b'CWS' + bytes([version]) + struct.pack('<I', len(raw) + 8)
                           + zlib.compress(raw))
        return target

    def change_body(abc):
        abc.bodies[0][1] += 1

    changed = altered('body', change_body)
    record('unchanged bytes accepted', lambda: verify_patch(source, source, [], []))
    record('declared method metadata edit accepted',
           lambda: verify_patch(source, changed, [body_key], []))
    record('undeclared method edit rejected',
           lambda: verify_patch(source, changed, [], []), True)
    signature = altered('signature', lambda abc: abc.methods[0].__setitem__(0, 1))
    record('method signature edit rejected',
           lambda: verify_patch(source, signature, [body_key], []), True)
    pool = altered('pool-prefix', lambda abc: abc.strings.__setitem__(1, b'changed'))
    record('constant pool prefix edit rejected',
           lambda: verify_patch(source, pool, [body_key], []), True)
    count = altered('body-count', lambda abc: abc.bodies.append(copy.deepcopy(abc.bodies[0])))
    record('original ABC new body rejected',
           lambda: verify_patch(source, count, [body_key], []), True)
    record('out-of-workspace path rejected', lambda: confined(ROOT.parent / 'outside'), True)
    record('wrong full input hash rejected', lambda: locked(source, '0' * 64), True)

    proof = work / 'base-proof.json'
    write_json(proof, {'passed': True, 'swf_sha256': sha(source)})
    plugin = work / 'plugin.py'
    plugin.write_text(
        'from pathlib import Path\n'
        'def apply(source, target, work):\n'
        f'    target.write_bytes(Path({str(changed)!r}).read_bytes())\n'
        f'    return {{"changed_bodies": [{body_key!r}], "helpers": []}}\n',
        encoding='utf-8')
    entry = {'id': 'guard-fixture', 'name': '保护栏测试夹具', 'status': 'enabled',
             'implementation_mode': 'single_method_pcode', 'plugin': str(plugin),
             'plugin_sha256': sha(plugin), 'input_sha256': sha(source),
             'output_sha256': sha(changed), 'expected_changed_bodies': [body_key],
             'expected_helpers': [], 'inputs': [{'path': str(changed), 'sha256': sha(changed)}]}
    config_path = work / 'config.json'
    config = {'schema_version': 1, 'base': {'path': str(source), 'sha256': sha(source),
              'verification_report': str(proof)}, 'patches': [entry]}
    write_json(config_path, config)
    first = run_pipeline(config_path, work / 'first.swf')
    assert not first['stages'][0]['cache_hit']
    assert first['output_sha256'] == sha(changed)
    assert not first['historical_air_evidence_applicable_to_swf']
    results.append({'test': 'fresh plugin output independently checked; old AIR acceptance withheld',
                    'passed': True})
    second = run_pipeline(config_path, work / 'second.swf')
    assert second['stages'][0]['cache_hit'] and second['output_sha256'] == first['output_sha256']
    assert second['working_run_dir'] != first['working_run_dir']
    results.append({'test': 'same code and inputs reuse hashed cache in separate run', 'passed': True})
    plugin.write_text(plugin.read_text('utf-8') + '# audited code revision\n', encoding='utf-8')
    entry['plugin_sha256'] = sha(plugin)
    write_json(config_path, config)
    third = run_pipeline(config_path, work / 'third.swf')
    assert not third['stages'][0]['cache_hit'] and third['output_sha256'] == first['output_sha256']
    assert third['stages'][0]['cache_key'] != first['stages'][0]['cache_key']
    results.append({'test': 'code revision invalidates cache and runs fresh', 'passed': True})
    report = {'passed': True, 'scope': '流水线保护栏与缓存测试；非新增游戏补丁验收',
              'count': len(results), 'results': results, 'fixture_dir': str(work)}
    write_json(ROOT / 'verification/patch-pipeline-tests.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
