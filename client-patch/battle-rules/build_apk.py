"""把已验证 SWF 候选装入原 APK；保留资源及原签名身份，不安装设备。"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

SWF = 'assets/worldflipper_android_release.swf'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def signature(name):
    parts = name.upper().split('/')
    return len(parts) == 2 and parts[0] == 'META-INF' and (
        parts[1] == 'MANIFEST.MF' or parts[1].endswith(('.RSA', '.SF', '.DSA', '.EC')))


def run(args):
    result = subprocess.run(list(map(str, args)), capture_output=True, text=True,
                            encoding='utf8', errors='replace')
    if result.returncode:
        raise RuntimeError(f'{Path(str(args[0])).name} failed ({result.returncode}); '
                           'tool output withheld because signing input may be sensitive')
    return result.stdout


def certificates(signer, apk):
    text = run([signer, 'verify', '--verbose', '--print-certs', apk])
    digests = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})', text)
    if not digests:
        raise ValueError('no verified signing certificate')
    return sorted(digests)


def build(a):
    if a.output.exists() or a.work.exists():
        raise ValueError('output and work must be new paths')
    if not os.environ.get(a.ks_pass_env) or not os.environ.get(a.key_pass_env or a.ks_pass_env):
        raise ValueError('keystore password environment variable missing')
    report = json.loads(a.patch_report.read_text(encoding='utf8'))
    base, swf = a.base.read_bytes(), a.swf.read_bytes()
    if sha(swf) != report['output_sha256'] or report['status'] != 'static_candidate_runtime_pending':
        raise ValueError('SWF does not match the checked patch report')
    original_certs = certificates(a.apksigner, a.base)
    a.work.mkdir(parents=True)
    unsigned, aligned = a.work/'unsigned.apk', a.work/'aligned.apk'
    preserved = {}
    with zipfile.ZipFile(a.base) as source, zipfile.ZipFile(unsigned, 'w') as dest:
        if source.namelist().count(SWF) != 1 or len(set(source.namelist())) != len(source.namelist()):
            raise ValueError('missing/duplicate APK entries')
        if sha(source.read(SWF)) != report['source_sha256']:
            raise ValueError('APK and SWF baseline differ')
        dest.comment = source.comment
        for member in source.infolist():
            if signature(member.filename):
                continue
            data = swf if member.filename == SWF else source.read(member)
            dest.writestr(member, data)
            preserved[member.filename] = (sha(data), member.compress_type)
    run([a.zipalign, '-p', '-f', '4', unsigned, aligned])
    a.output.parent.mkdir(parents=True, exist_ok=True)
    run([a.apksigner, 'sign', '--v4-signing-enabled', 'false', '--ks', a.keystore,
         '--ks-pass', f'env:{a.ks_pass_env}', '--key-pass', f'env:{a.key_pass_env or a.ks_pass_env}',
         '--out', a.output, aligned])
    result_certs = certificates(a.apksigner, a.output)
    if result_certs != original_certs:
        raise ValueError('candidate signer differs from baseline; do not install')
    run([a.zipalign, '-c', '-p', '4', a.output])
    with zipfile.ZipFile(a.output) as result:
        actual = {n for n in result.namelist() if not signature(n)}
        if actual != set(preserved) or result.testzip() is not None:
            raise ValueError('APK member inventory or CRC differs')
        for name, expected in preserved.items():
            got = (sha(result.read(name)), result.getinfo(name).compress_type)
            if got != expected:
                raise ValueError('non-target APK resource or compression changed: '+name)
    if a.base.read_bytes() != base:
        raise ValueError('base APK changed during build')
    result = {'status': 'signed_static_candidate', 'runtime_verified': False,
              'installed': False, 'base_sha256': sha(base), 'apk_sha256': sha(a.output.read_bytes()),
              'swf_sha256': sha(swf), 'certificate_sha256': result_certs,
              'preserved_non_swf_members': len(preserved)-1,
              'candidate_capabilities': ['gauge-gain-rules-v1', 'damage-type-rules-v1'],
              'apk': str(a.output.resolve())}
    a.output.with_suffix('.build-report.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps(result, ensure_ascii=False))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('base', 'swf', 'patch-report', 'output', 'work', 'zipalign', 'apksigner', 'keystore'):
        p.add_argument('--'+name, type=Path, required=True)
    p.add_argument('--ks-pass-env', required=True)
    p.add_argument('--key-pass-env')
    build(p.parse_args())


if __name__ == '__main__':
    main()
