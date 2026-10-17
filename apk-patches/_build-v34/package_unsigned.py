"""Replace only the SWF, strip old signatures, and zipalign without signing."""
import hashlib
import argparse
import json
from pathlib import Path
import re
import struct
import zipfile

from build_common import ROOT, ZIPALIGN, run, write_json

INPUT = Path(r'D:\WF\MuMuPlayer\vms\MuMuPlayer-15.0-1\private_shared\wt_v33.apk')
SWF_MEMBER = 'assets/worldflipper_android_release.swf'
INPUT_SHA = '3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def signature(name):
    return bool(re.fullmatch(r'META-INF/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))', name, re.I))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-only', action='store_true', help='read back existing output without replacing it')
    args = parser.parse_args()
    assert sha(INPUT.read_bytes()) == INPUT_SHA
    swf = (ROOT / 'v34.swf').read_bytes()
    verification = json.loads((ROOT / 'verification/swf-verification.json').read_text('utf-8'))
    assert verification['passed'] and verification['swf_sha256'] == sha(swf)
    unaligned = ROOT / 'work/v34-unsigned-unaligned.apk'
    aligned = ROOT / 'v34-unsigned-aligned.apk'
    removed = []
    with zipfile.ZipFile(INPUT) as before:
        removed = [name for name in before.namelist() if signature(name)]
        if not args.verify_only:
            assert not unaligned.exists() and not aligned.exists()
            with zipfile.ZipFile(unaligned, 'w') as output:
                assert len(before.namelist()) == len(set(before.namelist()))
                for info in before.infolist():
                    if not signature(info.filename):
                        output.writestr(info, swf if info.filename == SWF_MEMBER else before.read(info))
            run('zipalign', [ZIPALIGN, '-p', '-f', '4', unaligned, aligned])
    run('zipalign-check', [ZIPALIGN, '-c', '-p', '4', aligned])
    checks = []
    with zipfile.ZipFile(INPUT) as before, zipfile.ZipFile(aligned) as after, aligned.open('rb') as raw:
        expected = set(before.namelist()) - set(removed)
        assert set(after.namelist()) == expected
        assert len(after.namelist()) == len(expected)
        for name in sorted(expected):
            old, new = before.read(name), after.read(name)
            assert new == (swf if name == SWF_MEMBER else old), name
            info = after.getinfo(name)
            raw.seek(info.header_offset)
            local = raw.read(30)
            name_length, extra_length = struct.unpack_from('<HH', local, 26)
            offset = info.header_offset + 30 + name_length + extra_length
            alignment = 4096 if name.endswith('.so') else 4
            if info.compress_type == zipfile.ZIP_STORED and not info.is_dir():
                assert offset % alignment == 0, name
            checks.append({'name': name, 'sha256': sha(new), 'same_as_v33': old == new,
                           'size': len(new), 'compression': info.compress_type,
                           'data_offset': offset})
        for name in ('AndroidManifest.xml', 'resources.arsc', 'assets/META-INF/AIR/application.xml', 'classes.dex'):
            assert before.read(name) == after.read(name), name
        assert not any(signature(name) for name in after.namelist())
    data = aligned.read_bytes()
    eocd = data.rfind(b'PK\x05\x06')
    central = struct.unpack_from('<I', data, eocd + 16)[0]
    assert data[central:central + 4] == b'PK\x01\x02'
    assert data[central - 16:central] != b'APK Sig Block 42'
    aapt = ZIPALIGN.with_name('aapt2.exe')
    metadata = run('apk-badging', [aapt, 'dump', 'badging', aligned]).stdout.decode('utf-8')
    match = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", metadata)
    assert match and match[1] == 'com.leiting.wt'
    report = {'passed': True, 'input_apk_sha256': INPUT_SHA, 'apk_sha256': sha(data),
              'swf_sha256': sha(swf), 'package_name': match[1], 'versionCode': int(match[2]),
              'versionName': match[3], 'versionCode_unchanged': True,
              'manifest_resources_air_identity_unchanged': True, 'all_dex_and_native_unchanged': True,
              'removed_old_signature_entries': removed, 'apk_signature_block_absent': True,
              'unsigned': True, 'zipalign_passed': True, 'member_count': len(checks),
              'changed_payload_members': [x['name'] for x in checks if not x['same_as_v33']],
              'checks': checks}
    assert report['changed_payload_members'] == [SWF_MEMBER]
    write_json(ROOT / 'verification/apk-verification.json', report)
    print(json.dumps({k: v for k, v in report.items() if k != 'checks'}, indent=2))


if __name__ == '__main__':
    main()
