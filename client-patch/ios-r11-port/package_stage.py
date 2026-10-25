"""Package a finalized staged native/SWF replacement as an unsigned IPA."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import plistlib
import zipfile


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--linked', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = json.loads(args.linked.read_text(encoding='utf-8'))
    if report['status'] != 'linked_native_not_executed' or report.get('unwind_finalized') is not True:
        raise ValueError('Native unwind/function-start finalization is required before packaging')
    output = args.output.resolve()
    if output.exists() or output.with_suffix('.json').exists():
        raise FileExistsError('Preserve existing stage deliverables')
    source = report['source_ipa']
    source_path = Path(source['ipa'])
    assert output != source_path.resolve()
    assert sha(source_path.read_bytes()) == source['ipa_sha256']
    native, swf = Path(report['native_file']).read_bytes(), Path(report['swf_file']).read_bytes()
    assert sha(native) == report['native_sha256'] and sha(swf) == report['swf_sha256']
    replacements = {source['native_member']: native, source['swf_member']: swf}
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source_path) as old, zipfile.ZipFile(output, 'x', allowZip64=True) as new:
        assert len(old.namelist()) == len(set(old.namelist()))
        assert set(replacements) <= set(old.namelist())
        new.comment = old.comment
        for info in old.infolist():
            new.writestr(copy.copy(info), replacements.get(info.filename, old.read(info)))
    changed = []
    with zipfile.ZipFile(source_path) as old, zipfile.ZipFile(output) as new:
        assert old.namelist() == new.namelist() and old.comment == new.comment and new.testzip() is None
        for before, after in zip(old.infolist(), new.infolist()):
            assert all(getattr(before, key) == getattr(after, key) for key in
                       ('filename','date_time','compress_type','comment','extra','create_system','external_attr'))
            if old.read(before) != new.read(after):
                changed.append(before.filename)
        assert set(changed) == set(replacements)
        identity = plistlib.loads(new.read('Payload/worldflipper.app/Info.plist'))
        assert (identity['CFBundleIdentifier'], identity['CFBundleShortVersionString'], identity['CFBundleVersion']) == ('com.kulo.wf','1.8.4','1.8.46')
    result = dict(status='unsigned_offline_candidate', ipa=str(output), ipa_sha256=sha(output.read_bytes()),
                  size_bytes=output.stat().st_size, link_report=str(args.linked.resolve()),
                  native_sha256=sha(native), swf_sha256=sha(swf), full_abc_sha256=report['full_abc_sha256'],
                  full_abc_sha1=report['full_abc_sha1'], runtime_abc_sha256=report['runtime_abc_sha256'],
                  total_methods=report['total_methods'], changed_members=changed,
                  original_members_retained=True, zip_crc_verified=True, package_metadata_preserved=True,
                  signing='unsigned', native_executed=False, device_tested=False,
                  accepted_registry_updated=False, admission_materials_unchanged=True,
                  packaging_source_sha256=sha(Path(__file__).read_bytes()))
    output.with_suffix('.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: result[key] for key in ('status','ipa','ipa_sha256','total_methods')}, ensure_ascii=False))


if __name__ == '__main__':
    if not __debug__:
        raise RuntimeError('Required package identity assertions must remain enabled')
    main()
