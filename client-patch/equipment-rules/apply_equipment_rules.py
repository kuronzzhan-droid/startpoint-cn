"""从 1.4.1047 客户端 APK/SWF 应用装备规则补丁；不反编译、不覆盖输入、不安装设备。

    python -X utf8 client-patch/equipment-rules/apply_equipment_rules.py --input <1047.apk|swf> --check
    python -X utf8 client-patch/equipment-rules/apply_equipment_rules.py --input <1047.apk|swf> --output-dir <新目录>

输出目录（必须不存在）：baseline.swf、equipment-rules.swf、patch-report.json、verify-report.json、prepare-report.json。
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import overlay  # noqa: E402

rules = overlay.rules
_spec = importlib.util.spec_from_file_location('equipment_rules_verify', HERE / 'verify.py')
verify = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(verify)

SWF_MEMBER = 'assets/worldflipper_android_release.swf'
BASE_SWF_SHA = overlay.BASE_SWF_SHA
#: DEFAULT 参数下的产物。ABC 字节与压缩实现无关，是验收依据；整份 SWF 的哈希依赖 zlib 实现
#: （本机 Python 3.14.6 / zlib-ng 1.3.1 实测），接收方压缩实现不同时只会在报告里标注容器哈希不同。
TARGET_SWF_SHA = '6989d31a99a04882a152e5b55343ff2ead65c3ae433d1fc3b5da3985fdfe6237'
TARGET_ABC_SHA = 'd99246d9ced7b7e81c81d27ad436347cb2a1b02b861558776f566ef091773b22'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _abc_sha(data: bytes) -> str | None:
    """容器哈希不同（接收方 zlib 实现不同）时按主 ABC 判定是否已打过本补丁。"""
    if data[:3] not in (b'CWS', b'FWS'):
        return None
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 'probe.swf'
        path.write_bytes(data)
        try:
            return sha(overlay.SwfAbc(path).abc.serialize())
        except (Exception, SystemExit):        # noqa: BLE001 —— 解析器对坏输入会 SystemExit；一律视为未知
            return None


def inspect(source):
    """按主 SWF 内容判定基线；APK 其他成员与签名不参与判断。"""
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
    digest = sha(data)
    if digest == BASE_SWF_SHA:
        state = 'ready'
    elif digest == TARGET_SWF_SHA or _abc_sha(data) == TARGET_ABC_SHA:
        state = 'already_patched'
    else:
        raise ValueError('Unknown SWF baseline: ' + digest +
                         '. This patch only applies to the 1.4.1047 client (' + BASE_SWF_SHA + ').')
    return data, {'status': state, 'input': str(source), 'input_sha256': sha(raw), 'swf_sha256': digest,
                  'target_swf_sha256': TARGET_SWF_SHA, 'target_abc_sha256': TARGET_ABC_SHA}


def prepare(source, output_dir=None, check_only=False):
    data, result = inspect(source)
    if check_only or result['status'] == 'already_patched':
        return result
    if output_dir is None:
        raise ValueError('--output-dir is required unless --check is used')
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=False)
    baseline, patched = output_dir / 'baseline.swf', output_dir / 'equipment-rules.swf'
    report_path, verify_path = output_dir / 'patch-report.json', output_dir / 'verify-report.json'
    baseline.write_bytes(data)
    patch = overlay.apply(baseline, patched, report_path, rules.DEFAULT)
    if patch['output_abc_sha256'] != TARGET_ABC_SHA:
        raise ValueError('patched ABC does not match the verified target; do not use this output')
    checked = verify.verify(patched, baseline, rules.DEFAULT)
    verify_path.write_text(json.dumps(checked, ensure_ascii=False, indent=2, default=str) + '\n', encoding='utf8')
    if not checked['ok']:
        raise ValueError('independent verification failed; see ' + str(verify_path))
    if sha(Path(source).read_bytes()) != result['input_sha256']:
        raise ValueError('input changed while preparing the patch')
    result.update(status='prepared', output_swf=str(patched), output_swf_sha256=patch['output_sha256'],
                  swf_container_matches_target=patch['output_sha256'] == TARGET_SWF_SHA,
                  patch_report=str(report_path), verify_report=str(verify_path),
                  changed_methods=sorted(patch['methods']),
                  added_methods=[m['name'] for m in patch['added_methods']],
                  capabilities_added=patch['capabilities_added'], installed=False)
    (output_dir / 'prepare-report.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
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
