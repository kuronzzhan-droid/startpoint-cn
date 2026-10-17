"""Build and verify one version-bumped APK while retaining every ABI payload."""
import hashlib
from pathlib import Path
import re
import struct
import zipfile

from apk_manifest import decode_manifest, patch_version_code
from build_common import ROOT, ZIPALIGN, run, write_json

SWF_MEMBER = 'assets/worldflipper_android_release.swf'
MANIFEST = 'AndroidManifest.xml'
BASE_SWF_SHA = '3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4'
VARIANTS = {
    'x86': {'input': Path(r'D:\WF\bughunt-20261015\apk\in\v33-x86.apk'),
            'sha256': '572dd17256de6708b9cdcbe752e184a97b44781bce8fd5ffacf7be7413e0c331',
            'abis': ['arm64-v8a', 'x86_64'], 'output': 'v34-x86-unsigned-aligned.apk'},
    'arm64': {'input': Path(r'D:\WF\MuMuPlayer\vms\MuMuPlayer-15.0-1\private_shared\wt_v33.apk'),
              'sha256': '3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532',
              'abis': ['arm64-v8a'], 'output': 'v34-arm64-unsigned-aligned.apk'},
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def signature(name):
    return bool(re.fullmatch(r'META-INF/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))', name, re.I))


def preflight():
    """All input identity checks finish before any package output is written."""
    for variant, spec in VARIANTS.items():
        assert sha(spec['input'].read_bytes()) == spec['sha256'], f'{variant} APK identity mismatch'
        with zipfile.ZipFile(spec['input']) as archive:
            assert sha(archive.read(SWF_MEMBER)) == BASE_SWF_SHA, f'{variant} SWF identity mismatch'
            identity = decode_manifest(archive.read(MANIFEST))
            assert identity['package_name'] == 'com.leiting.wt'
            assert identity['versionCode'] == 1008001


def build_variant(variant, swf_path, work, version_code=1008002):
    spec = VARIANTS[variant]
    swf = Path(swf_path).read_bytes()
    work.mkdir(parents=True, exist_ok=True)
    unaligned, aligned = work / 'unsigned.apk', work / spec['output']
    assert not unaligned.exists() and not aligned.exists()
    with zipfile.ZipFile(spec['input']) as before:
        names = before.namelist()
        assert len(names) == len(set(names))
        manifest, manifest_edit = patch_version_code(before.read(MANIFEST), 1008001, version_code)
        replacements = {MANIFEST: manifest, SWF_MEMBER: swf}
        removed = [name for name in names if signature(name)]
        with zipfile.ZipFile(unaligned, 'w') as output:
            for info in before.infolist():
                if not signature(info.filename):
                    output.writestr(info, replacements.get(info.filename, before.read(info)))
    run(variant + '-zipalign', [ZIPALIGN, '-p', '-f', '4', unaligned, aligned])
    run(variant + '-zipalign-check', [ZIPALIGN, '-c', '-p', '4', aligned])
    checks, libraries, ane_members = [], [], []
    with zipfile.ZipFile(spec['input']) as before, zipfile.ZipFile(aligned) as after, aligned.open('rb') as raw:
        expected = set(names) - set(removed)
        assert set(after.namelist()) == expected and len(after.namelist()) == len(expected)
        for name in sorted(expected):
            old, new = before.read(name), after.read(name)
            assert new == replacements.get(name, old), (variant, name)
            info = after.getinfo(name)
            assert info.compress_type == before.getinfo(name).compress_type, (variant, name, 'compression')
            raw.seek(info.header_offset)
            local = raw.read(30)
            assert local[:4] == b'PK\x03\x04'
            nl, el = struct.unpack_from('<HH', local, 26)
            offset = info.header_offset + 30 + nl + el
            if info.compress_type == zipfile.ZIP_STORED and not info.is_dir():
                assert offset % (4096 if name.endswith('.so') else 4) == 0, name
            row = {'name': name, 'sha256': sha(new), 'same_as_input': old == new,
                   'size': len(new), 'compression': info.compress_type, 'data_offset': offset}
            checks.append(row)
            if name.startswith('lib/') and name.endswith('.so'):
                assert old == new
                libraries.append(row)
            if name.startswith('assets/META-INF/AIR/extensions/'):
                assert old == new
                ane_members.append(row)
        identity = decode_manifest(after.read(MANIFEST))
        assert identity['package_name'] == 'com.leiting.wt' and identity['versionCode'] == version_code
        assert before.read('assets/META-INF/AIR/application.xml') == after.read('assets/META-INF/AIR/application.xml')
        assert before.read('resources.arsc') == after.read('resources.arsc')
        assert all(before.read(n) == after.read(n) for n in expected if re.fullmatch(r'classes\d*\.dex', n))
        assert after.read(SWF_MEMBER) == swf
    abis = sorted({r['name'].split('/')[1] for r in libraries})
    assert abis == spec['abis'], abis
    x64_platforms = sorted({r['name'].split('/META-INF/ANE/Android-x64/')[0]
                            for r in ane_members if '/META-INF/ANE/Android-x64/' in r['name']})
    assert len(x64_platforms) == (13 if variant == 'x86' else 0)
    data = aligned.read_bytes()
    eocd = data.rfind(b'PK\x05\x06')
    central = struct.unpack_from('<I', data, eocd + 16)[0]
    assert data[central:central + 4] == b'PK\x01\x02'
    assert data[central - 16:central] != b'APK Sig Block 42'
    badging = run(variant + '-badging', [ZIPALIGN.with_name('aapt2.exe'), 'dump', 'badging', aligned]).stdout.decode('utf-8')
    assert re.search(r"package: name='com.leiting.wt' versionCode='" + str(version_code) + "'", badging)
    changes = [r['name'] for r in checks if not r['same_as_input']]
    assert changes == [MANIFEST, SWF_MEMBER], changes
    report = {'passed': True, 'variant': variant, 'input_apk': str(spec['input']),
              'input_apk_sha256': spec['sha256'], 'apk_sha256': sha(data), 'bytes': len(data),
              'swf_sha256': sha(swf), 'package_name': identity['package_name'],
              'versionCode': version_code, 'versionName': identity['versionName'],
              'version_edit': manifest_edit, 'application_xml_changed': False,
              'resources_arsc_changed': False, 'dex_and_native_byte_identical': True,
              'all_ane_members_byte_identical': True, 'abi_list': abis,
              'libraries': libraries, 'android_x64_platforms': x64_platforms,
              'ane_member_count': len(ane_members), 'changed_payload_members': changes,
              'removed_signature_entries': removed, 'apk_signature_block_absent': True,
              'unsigned': True, 'zipalign_passed': True, 'member_count': len(checks), 'checks': checks}
    write_json(work / 'verification.json', report)
    return aligned, report
