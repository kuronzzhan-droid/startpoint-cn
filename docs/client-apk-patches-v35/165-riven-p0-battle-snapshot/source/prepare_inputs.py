"""Lock final p13 inputs, copy its build source, and inventory preserved inputs."""
import json
import zipfile
from bootstrap import (ROOT, P0, P13, BASE, BASE_SHA, APK_SHA, sha,
                       require_hash, write_json, write_immutable)


def main():
    manifest_path = P13 / 'P13-DELIVERY-MANIFEST.json'
    manifest = json.loads(manifest_path.read_text('utf-8-sig'))
    assert manifest['status'] == 'sealed'
    swf = P13 / 'client/build/v35abyss-p13-local.swf'
    apk = P13 / 'apk/abyss-beast-v35pf4p13-local-wf-x86.signed.apk'
    for path, expected in ((swf, BASE_SHA), (apk, APK_SHA)):
        relative = str(path.relative_to(P13))
        assert 'superseded' not in path.parts
        assert manifest['files'][relative]['sha256'] == expected
        assert manifest['files'][relative]['size'] == path.stat().st_size
        require_hash(path, expected)
    with zipfile.ZipFile(apk) as archive:
        assert archive.read('assets/worldflipper_android_release.swf') == swf.read_bytes()
    write_immutable(BASE, swf.read_bytes())
    copied = []
    source_manifest = json.loads((P13 / 'P13-SOURCE-MANIFEST.json').read_text('utf-8-sig'))
    assert source_manifest['status'] == 'sealed'
    for relative, expected in source_manifest['files'].items():
        src = P13 / relative
        assert src.resolve().is_relative_to(P13.resolve()) and 'superseded' not in src.parts
        require_hash(src, expected)
        dest = ROOT / 'inherited-p13' / relative
        write_immutable(dest, src.read_bytes())
        copied.append({'source': str(src), 'copy': str(dest), 'sha256': expected})
    for name in ('P13-REPORT.md', 'P13-DELIVERY-MANIFEST.json',
                 'P13-SOURCE-MANIFEST.json', 'baseline-locks.json', 'build-lock.json'):
        src = P13 / name
        dest = ROOT / 'inherited-p13' / name
        write_immutable(dest, src.read_bytes())
        copied.append({'source': str(src), 'copy': str(dest), 'sha256': sha(src.read_bytes())})
    # Record the sealed p13 files without reading unused superseded candidates.
    preserved_p13 = []
    for relative, value in manifest['files'].items():
        path = P13 / relative
        assert path.resolve().is_relative_to(P13.resolve()) and 'superseded' not in path.parts
        require_hash(path, value['sha256'])
        preserved_p13.append({'path': str(path), 'sha256': value['sha256']})
    preserved_p0 = []
    for path in sorted(P0.rglob('*')):
        if not path.is_file() or ROOT in path.parents or path.name in ('run.log',):
            continue
        if path.suffix.lower() not in ('.py', '.java', '.json', '.md', '.txt', '.swf', '.apk'):
            continue
        preserved_p0.append({'path': str(path), 'sha256': sha(path.read_bytes())})
    report = {'status': 'passed', 'p13_swf': str(swf), 'p13_swf_sha256': BASE_SHA,
              'p13_apk': str(apk), 'p13_apk_sha256': APK_SHA,
              'p13_delivery_manifest_sha256': sha(manifest_path.read_bytes()),
              'p13_report_sha256': sha((P13 / 'P13-REPORT.md').read_bytes()),
              'copied_swf': str(BASE), 'embedded_swf_identical': True,
              'copied_build_chain': copied, 'preserved_p13_files': preserved_p13,
              'preserved_p0_files': preserved_p0, 'superseded_used': False}
    write_json(ROOT / 'audit/input-lock.json', report)
    print({'status': 'passed', 'copied_build_chain_files': len(copied),
           'p13_files_locked': len(preserved_p13), 'p0_files_locked': len(preserved_p0)})


if __name__ == '__main__':
    main()
