"""从编成装备槽强化框客户端 APK/SWF 应用觉醒专属素材补丁；不反编译、不覆盖输入、不安装设备。

    python -X utf8 client-patch/equipment-awakening-material/apply_equipment_awakening_material.py --input <2f085757.apk|swf> --check
    python -X utf8 client-patch/equipment-awakening-material/apply_equipment_awakening_material.py --input <2f085757.apk|swf> --output-dir <新目录>

基线按**主 ABC** 判定（2a9583cd…，即 equipment-enhanced-party-frame b 版产物，APK 2f085757；a 版 016cd927 /
14396ce0 有「武器图标会消失」缺陷，拒绝）；
容器哈希 5bd476f6… 只作参考。
被改方法体另有方法锁（baseline.json：体下标、sha256、header），锁不符就拒绝 —— 没有任何自动降级或兜底。
其他基线一律拒绝；已经打过本补丁的输入报告 already_patched。

输出目录（必须不存在）：baseline.swf、equipment-awakening-material.swf、patch-report.json、
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


overlay = _load('equipment_awakening_material_overlay', HERE / 'overlay.py')
verify = _load('equipment_awakening_material_verify', HERE / 'verify.py')
rules = overlay.rules

SWF_MEMBER = 'assets/worldflipper_android_release.swf'
OUTPUT_NAME = 'equipment-awakening-material.swf'
BASE_ABC_SHA = overlay.BASE_ABC_SHA
BASE_SWF_SHA = overlay.BASE_SWF_SHA
#: 本补丁产物。主 ABC 是验收依据；基线与产物都是未压缩的 FWS（SwfAbc 保持原签名），容器哈希也可复现。
TARGET_ABC_SHA = '22292c21361fa505bccd563852810e6fb1d696ae03823f05ff694a74fbdf2ec1'
TARGET_SWF_SHA = '15c8cba8eb86c8e86be2d9508b810d7a4288b7aa000a4ae7e215e1c2132efa0a'
#: 作废的 a 版链：编成槽框 a 版（APK 14396ce0，主 ABC 016cd927，「武器图标会消失」）与在它上面打出的本补丁产物
#: （07bc8022，候选 APK 8d4e8583 里的那一层）。两者都拒绝，并提示改用 b 版底包 2f085757。
SUPERSEDED_ABC_SHAS = {
    '016cd9270a5b9c0d2d7ae6e701f5d2bcbe6ac10c59a72d1f003ccd04234169dd': 'equipment-enhanced-party-frame a (APK 14396ce0)',
    '07bc80224d299fc92959637322b2aa9bc72918fbe9370b7476ed5b79814d5800': 'equipment-awakening-material on party-frame a',
}


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
        elif main_abc in SUPERSEDED_ABC_SHAS:
            raise ValueError('Superseded SWF baseline: main ABC ' + main_abc + ' is ' + SUPERSEDED_ABC_SHAS[main_abc] +
                             ', which still disposes shared icon textures; apply this patch to the '
                             'equipment-enhanced-party-frame b client (main ABC ' + BASE_ABC_SHA + ', APK 2f085757).')
        else:
            raise ValueError('Unknown SWF baseline: container ' + digest + ', main ABC ' + str(main_abc) +
                             '. This patch only applies to the equipment-enhanced-party-frame client (main ABC ' +
                             BASE_ABC_SHA + ').')
    return data, {'status': state, 'input': str(source), 'input_sha256': sha(raw), 'swf_sha256': digest,
                  'swf_abc_sha256': main_abc,
                  'swf_container_matches_party_frame': digest == BASE_SWF_SHA,
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
