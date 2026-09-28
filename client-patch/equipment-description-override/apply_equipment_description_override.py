"""从 equipment-rules 客户端 APK/SWF 应用装备详情文案覆盖；不反编译、不覆盖输入、不安装设备。

    python -X utf8 client-patch/equipment-description-override/apply_equipment_description_override.py --input <e03bc22b.apk|swf> --check
    python -X utf8 client-patch/equipment-description-override/apply_equipment_description_override.py --input <e03bc22b.apk|swf> --output-dir <新目录>

基线按**主 ABC** 判定（d99246d9…，即 equipment-rules 产物）；容器哈希 6989d31a… 只作参考
（该 SWF 是未压缩的 FWS，本机产物的容器哈希可复现；但同一 ABC 可能被重新压成 CWS 等不同容器）。
其他基线一律拒绝；已经打过本补丁的输入报告 already_patched。

输出目录（必须不存在）：baseline.swf、equipment-description-override.swf、patch-report.json、
verify-report.json、prepare-report.json。
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name, path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


overlay = _load('equipment_desc_override_overlay', HERE / 'overlay.py')
verify = _load('equipment_desc_override_verify', HERE / 'verify.py')
rules = overlay.rules

SWF_MEMBER = 'assets/worldflipper_android_release.swf'
OUTPUT_NAME = 'equipment-description-override.swf'
BASE_ABC_SHA = overlay.BASE_ABC_SHA
BASE_SWF_SHA = overlay.BASE_SWF_SHA
#: 本补丁产物。主 ABC 是验收依据；基线与产物都是未压缩的 FWS（SwfAbc 保持原签名），
#: 所以容器哈希也可复现，只在输入是同一 ABC 的其他容器（如重压成 CWS）时才会不同——那种情况只在报告里标注。
TARGET_ABC_SHA = '4994e23d612c24a7c13072bf641b9b11ca0aa2e36561cb3d521bda16e325c38b'
TARGET_SWF_SHA = 'cdc4c1d1fea3080e2974a1417e5179537c9e460e3ce6c13068676921ab410a44'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def abc_sha(data: bytes) -> str | None:
    """主 ABC 的 sha256；不是可解析的 SWF 时返回 None。"""
    if data[:3] not in (b'CWS', b'FWS'):
        return None
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 'probe.swf'
        path.write_bytes(data)
        try:
            return sha(overlay.SwfAbc(path).abc.serialize())
        except (Exception, SystemExit):        # noqa: BLE001 —— 解析器对坏输入会 SystemExit；一律视为未知
            return None


def inspect(source):
    """按主 SWF 的主 ABC 判定基线；APK 其他成员与签名不参与判断。"""
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
    if digest == TARGET_SWF_SHA:
        state, main_abc = 'already_patched', TARGET_ABC_SHA
    else:
        main_abc = abc_sha(data)
        if main_abc == BASE_ABC_SHA:
            state = 'ready'
        elif main_abc == TARGET_ABC_SHA:
            state = 'already_patched'
        else:
            raise ValueError('Unknown SWF baseline: container ' + digest + ', main ABC ' + str(main_abc) +
                             '. This patch only applies to the equipment-rules client (main ABC ' +
                             BASE_ABC_SHA + ').')
    return data, {'status': state, 'input': str(source), 'input_sha256': sha(raw), 'swf_sha256': digest,
                  'swf_abc_sha256': main_abc,
                  'swf_container_matches_equipment_rules': digest == BASE_SWF_SHA,
                  'target_swf_sha256': TARGET_SWF_SHA, 'target_abc_sha256': TARGET_ABC_SHA}


def prepare(source, output_dir=None, check_only=False, mutants=True):
    data, result = inspect(source)
    if check_only or result['status'] == 'already_patched':
        return result
    if output_dir is None:
        raise ValueError('--output-dir is required unless --check is used')
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=False)
    baseline, patched = output_dir / 'baseline.swf', output_dir / OUTPUT_NAME
    report_path, verify_path = output_dir / 'patch-report.json', output_dir / 'verify-report.json'
    baseline.write_bytes(data)
    patch = overlay.apply(baseline, patched, report_path)
    if patch['output_abc_sha256'] != TARGET_ABC_SHA:
        raise ValueError('patched ABC does not match the verified target; do not use this output')
    checked = verify.verify(patched, baseline, mutants=mutants)
    verify_path.write_text(json.dumps(checked, ensure_ascii=False, indent=2, default=str) + '\n', encoding='utf8')
    if not checked['ok']:
        raise ValueError('independent verification failed; see ' + str(verify_path))
    if sha(Path(source).read_bytes()) != result['input_sha256']:
        raise ValueError('input changed while preparing the patch')
    result.update(status='prepared', output_swf=str(patched), output_swf_sha256=patch['output_sha256'],
                  output_abc_sha256=patch['output_abc_sha256'],
                  swf_container_matches_target=patch['output_sha256'] == TARGET_SWF_SHA,
                  patch_report=str(report_path), verify_report=str(verify_path),
                  changed_methods=sorted(patch['methods']), headers=patch['headers'],
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
