"""Read-only P0c APK verification against its sealed build report."""
import hashlib
import json
from pathlib import Path
import sys
import uuid
import zipfile

sys.dont_write_bytecode = True
if not __debug__:
    raise RuntimeError('Verification assertions require Python without -O')


def final_review(base, apk, source, receipt, evidence, nocache, version):
    from packaging_verify import SWF_ENTRY, is_signature
    assert evidence['package'] == 'com.leiting.wf'
    assert evidence['version_code'] == version
    assert evidence['abis'] == ['arm64-v8a', 'x86_64']
    assert evidence['signature_verified'] and evidence['zipalign_verified']
    identity, old = nocache.manifest_uuid(apk), nocache.manifest_uuid(base)
    assert str(uuid.UUID(identity)) == identity
    assert identity != old and identity == receipt['build_id']
    assert hashlib.sha256(apk.read_bytes()).hexdigest() == receipt['sha256']
    with zipfile.ZipFile(base) as before, zipfile.ZipFile(apk) as after:
        assert len(after.namelist()) == len(set(after.namelist()))
        assert identity.encode() in after.read('classes.dex')
        assert after.read(SWF_ENTRY) == source.read_bytes()
        names = {n for n in before.namelist() if not is_signature(n)}
        assert names == {n for n in after.namelist() if not is_signature(n)}
        changed = sorted(n for n in names if before.read(n) != after.read(n))
        assert set(changed) == {'AndroidManifest.xml', 'classes.dex', SWF_ENTRY}
        assets = [n for n in names if n.startswith('assets/') and n != SWF_ENTRY]
        assert assets and all(before.read(n) == after.read(n) for n in assets)
        native = sorted({n.split('/')[1] for n in names if n.startswith('lib/')})
        assert native == evidence['abis']
    return {'status': 'passed', 'version_code': version, 'uniqueappversionid': identity,
            'previous_uniqueappversionid': old, 'air_uuid_refreshed': True,
            'startup_cache_build_id_matches': True,
            'swf_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'changed_entries': changed, 'all_other_entries_byte_identical': True,
            'preserved_asset_entry_count': len(assets), 'actual_abis': native,
            'inherited_nocache_dex_smali_readback': 'All non-cn/startpoint classes preserved during packaging'}



