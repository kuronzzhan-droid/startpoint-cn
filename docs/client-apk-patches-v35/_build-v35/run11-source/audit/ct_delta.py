"""第三版对第二版的独立二进制差分：两处插入、追加助手、完整可逆性。"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import bootstrap
import asm
import bodies
from bootstrap import output_path
from integrity import compare, unchanged_scaffolding
from multiabc import envelope
from swfabc import SwfAbc
from audit import ct_native

BEFORE_SHA = '608bf66914dc5e0a0b8c16e795b88692f67b2b9a23a898be4254c42710e4353b'
LOCKS = {
    'MemberImpl/wfxHealAnyDamage': (
        '460581f38184615d7581f23a6182b96de844531a29298fa818db20f0e0f23ad3', [5, 10, 1, 2]),
    'MemberImpl$/wfxHealDamageTick': (
        'f67cf76ffee19cd81e3729613ae451cf1fb508946282e35f9471b80d5ef25b87', [4, 7, 1, 2]),
}
PROTECTED = ('MemberImpl/wfxHealAnyValue', 'MemberImpl/wfxHealAnyFever',
             'MemberImpl/wfxHealAnyMembers', 'MemberImpl/wfxHealAnySample',
             'MemberImpl$/wfxHealDamageQueue', 'MemberImpl/wfxHealDamageEmit')
ADDED = {'MemberImpl/wfxHealAnyCTRecord', 'MemberImpl$/wfxHealAnyCTQueue',
         'MemberImpl$/wfxHealAnyCTTick'}
SLOTS = {'wfxHealAnyCTBattle', 'wfxHealAnyCTPending'}
MEMBER = 'pinball.scene.battle.battle.squad.member::MemberImpl'


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def source_snapshot():
    paths = [Path(__file__), ROOT/'audit/ct_native.py', ROOT/'bootstrap.py',
             ROOT/'integrity.py', ROOT/'multiabc.py', ROOT/'static_check.py']
    paths += sorted((ROOT/'vendor').glob('*.py'))
    return {p.relative_to(ROOT).as_posix(): digest(p.read_bytes()) for p in paths}


def verify(before=None, after=None, write=True):
    sources = source_snapshot()
    before = Path(before or ROOT/'work/pre-ct/v35k.swf')
    after = Path(after or ROOT/'v35k.swf')
    assert digest(before.read_bytes()) == BEFORE_SHA, '第二版整体 SHA 不符'
    assert digest(after.read_bytes()) != BEFORE_SHA, '第三版尚未生成'
    old, new = SwfAbc(before), SwfAbc(after)
    locks = {}
    for label, (expected_sha, header) in LOCKS.items():
        b = old.abc.bodies[bodies.resolve(old.abc, label)]
        a = new.abc.bodies[bodies.resolve(new.abc, label)]
        assert digest(b[5]) == expected_sha and b[1:5] == header, label
        count = len(asm.decode(a[5]))-len(asm.decode(b[5]))
        assert count > 0, 'missing insertion: '+label
        restored = asm.unsplice_many(a[5], [(2, count, asm.ENTER)])
        assert restored == b[5], 'not a single reversible entry splice: '+label
        assert a[3:5] == b[3:5] and a[6:] == b[6:], 'scope/exception/trait changed: '+label
        locks[label] = {'before_sha256': expected_sha, 'before_header': header,
                        'after_sha256': digest(a[5]), 'after_header': a[1:5],
                        'insertion': {'at': 2, 'instruction_count': count},
                        'removed_insertion_restores_original_code': True}
    result = compare(old, new, set(LOCKS), abc_only=True)
    assert set(result['added_methods']) == ADDED, result['added_methods']
    traits = result['appended_traits']
    assert all(t['class'] == MEMBER for t in traits), 'new trait outside MemberImpl'
    slots = [t for t in traits if t['kind'] == 0]
    assert len(slots) == 2 and all(t['static'] for t in slots)
    assert {t['name'] for t in slots} == SLOTS, slots
    protected = {}
    for label in PROTECTED:
        b = old.abc.bodies[bodies.resolve(old.abc, label)]
        a = new.abc.bodies[bodies.resolve(new.abc, label)]
        assert b == a, 'protected original body record changed: '+label
        protected[label] = {'sha256': digest(b[5]), 'header': b[1:5],
                            'complete_body_record_byte_identical': True}
    restored = unchanged_scaffolding(old, new, set(LOCKS))
    package = envelope(old, new, {old.tag_name.decode('utf-8')})
    native = ct_native.inspect(write=write)
    assert source_snapshot() == sources, '审计期间源码变化'
    native_artifacts = []
    if write:
        native_artifacts = [{'path': item['file'],
                             'sha256': digest((ROOT/item['file']).read_bytes())}
                            for item in native['methods'].values()]
    report = {
        'schema_version': 1, 'status': 'passed',
        'previous_swf_sha256': BEFORE_SHA,
        'output_swf_sha256': digest(after.read_bytes()),
        'previous_path': 'work/pre-ct/v35k.swf',
        'changed_methods_dual_locks': locks, 'protected_methods': protected,
        'integrity': result, 'restored_main_abc': restored, 'swf_envelope': package,
        'native_evidence': {'path': 'audit/ct-native-evidence.json',
                            'sha256': (digest((ROOT/'audit/ct-native-evidence.json').read_bytes())
                                       if write else None),
                            'pcode_files': native_artifacts,
                            'logic_frames_per_second': native['logic_frames_per_second']},
        'source_locks': sources, 'sources_unchanged_during_verification': True,
        'scope': '二进制及静态验证；行为验证由 CT scenarios 和第二版真实字节码对照补充',
    }
    if write:
        output_path(ROOT/'audit/ct-delta-report.json').write_text(
            json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', type=Path)
    parser.add_argument('--after', type=Path)
    args = parser.parse_args()
    report = verify(args.before, args.after)
    print(json.dumps({'status': report['status'], 'output_swf_sha256': report['output_swf_sha256'],
                      'changed': sorted(report['changed_methods_dual_locks']),
                      'added': report['integrity']['added_methods']}, ensure_ascii=False, indent=2))
