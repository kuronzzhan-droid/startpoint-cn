"""从现有 APK/SWF 应用回槽性能补丁；不反编译、不覆盖输入、不自动安装。"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

from gauge_perf_overlay import BASE_SHA, apply

SWF_MEMBER = 'assets/worldflipper_android_release.swf'
TARGET_SHA = '6e7b2db7923d2456ce2b6edc9a42aba51f1f87a099ecc4f606c1de7fc302c497'


def inspect(source):
    """按 SWF 内容判定基线，APK 签名和非 SWF 资源不影响兼容性判断。"""
    source = Path(source).resolve(strict=True)
    raw = source.read_bytes()
    if source.suffix.lower() == '.apk':
        with zipfile.ZipFile(source) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)) or names.count(SWF_MEMBER) != 1:
                raise ValueError('APK contains duplicate entries or lacks the main SWF')
            data = archive.read(SWF_MEMBER)
    elif source.suffix.lower() == '.swf':
        data = raw
    else:
        raise ValueError('input must be an APK or SWF')
    digest = hashlib.sha256(data).hexdigest()
    state = {BASE_SHA: 'ready', TARGET_SHA: 'already_patched'}.get(digest)
    if state is None:
        raise ValueError('Unknown SWF baseline: '+digest+
                         '. Preserve this input; merge its changes before applying this patch.')
    return data, dict(status=state, input=str(source),
                     input_sha256=hashlib.sha256(raw).hexdigest(),
                     swf_sha256=digest, target_swf_sha256=TARGET_SHA)


def prepare(source, output_dir=None, check_only=False):
    data, result = inspect(source)
    if check_only or result['status'] == 'already_patched':
        return result
    if output_dir is None:
        raise ValueError('--output-dir is required unless --check is used')
    output_dir = Path(output_dir).resolve()
    # New directory only: never overwrite the old client, reports or prior builds.
    output_dir.mkdir(parents=True, exist_ok=False)
    original = output_dir/'baseline.swf'
    patched = output_dir/'gauge-performance.swf'
    report = output_dir/'patch-report.json'
    original.write_bytes(data)
    patch_result = apply(original, patched, report)
    if patch_result['output_sha256'] != TARGET_SHA:
        raise ValueError('output does not match the verified repair; do not use this output')
    if hashlib.sha256(Path(source).read_bytes()).hexdigest() != result['input_sha256']:
        raise ValueError('input changed while preparing the patch')
    result.update(status='prepared', output_swf=str(patched), patch_report=str(report),
                  changed_methods=list(patch_result['methods']), installed=False)
    (output_dir/'prepare-report.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--check', action='store_true', help='仅检查基线，不写文件')
    args = parser.parse_args()
    try:
        result = prepare(args.input, args.output_dir, args.check)
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        parser.exit(2, f'Patch refused: {exc}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
