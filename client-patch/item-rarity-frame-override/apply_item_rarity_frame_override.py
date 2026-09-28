"""从已打过装备强化外观 v1 的客户端 APK/SWF 应用物品品质底色覆盖；不反编译、不覆盖输入、不安装设备。

    python -X utf8 client-patch/item-rarity-frame-override/apply_item_rarity_frame_override.py --input <底包.apk|swf> --check
    python -X utf8 client-patch/item-rarity-frame-override/apply_item_rarity_frame_override.py --input <底包.apk|swf> --output-dir <新目录>
    （登记表以外的底包）再加 --base-build-report <底包 APK 的 build-report.json>

底包按**主 ABC** 判定：rules.KNOWN_BASES 登记的 4 个（编成槽框 a 016cd927 / b 2a9583cd、觉醒专属素材 22292c21、
最终合成链 c39746e0），或由底包构建报告显式声明（报告的 swf_sha256 必须等于输入的主 SWF）。
两个被改方法体另有方法锁（baseline.json：体下标、sha256、header），锁不符就拒绝 —— 没有任何自动降级或兜底。
已经打过本补丁的输入（主 ABC 是登记的产物，或 setRarity 里已有本补丁的前缀）报告 already_patched。

输出目录（必须不存在）：baseline.swf、item-rarity-frame-override.swf、patch-report.json、
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


overlay = _load('item_rarity_frame_override_overlay', HERE / 'overlay.py')
verify = _load('item_rarity_frame_override_verify', HERE / 'verify.py')
rules = overlay.rules

SWF_MEMBER = 'assets/worldflipper_android_release.swf'
OUTPUT_NAME = 'item-rarity-frame-override.swf'
TARGET_ABCS = {entry['target_abc_sha256']: base for base, entry in rules.KNOWN_BASES.items()}


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


def _probe_locks(data: bytes) -> dict:
    """未登记底包：逐个方法报告锁是否相符（只报告，不放行）。"""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 'probe.swf'
        path.write_bytes(data)
        abc = overlay.SwfAbc(path).abc
        locks = json.loads((HERE / 'baseline.json').read_text(encoding='utf8'))
        out = {}
        for label, lock in locks.items():
            body = abc.bodies[overlay.bodies.resolve(abc, label)]
            out[label] = {'sha_matches': sha(body[5]) == lock['sha'], 'header_matches': body[1:5] == lock['header']}
        return out


def inspect(source, base_report=None):
    """按主 SWF 的主 ABC 判定底包；APK 其他成员与签名不参与判断。"""
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
    main_abc = abc_sha(data)
    result = {'input': str(source), 'input_sha256': sha(raw), 'swf_sha256': digest, 'swf_abc_sha256': main_abc}
    if main_abc in TARGET_ABCS:
        result.update(status='already_patched', base_abc_sha256=TARGET_ABCS[main_abc])
        return data, result
    if main_abc is None:
        raise ValueError('input main SWF is not parseable')
    locks = _probe_locks(data)
    result['method_locks'] = locks
    if not all(v['sha_matches'] and v['header_matches'] for v in locks.values()):
        raise ValueError('Method locks do not match (main ABC ' + main_abc + '): ' + json.dumps(locks) +
                         '. This patch stacks only on a client whose ItemThumbnailView.setRarity is the '
                         'equipment-enhanced-look v1 body and whose ItemThumbnailView.replace is native.')
    base = overlay.declared_base(base_report, digest, main_abc)
    result.update(status='ready', base=base, target_abc_sha256=rules.KNOWN_BASES.get(main_abc, {}).get(
        'target_abc_sha256'))
    return data, result


def prepare(source, output_dir=None, check_only=False, mutants=True, base_report=None):
    data, result = inspect(source, base_report)
    if check_only or result['status'] == 'already_patched':
        return result
    if output_dir is None:
        raise ValueError('--output-dir is required unless --check is used')
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=False)
    baseline, patched = output_dir / 'baseline.swf', output_dir / OUTPUT_NAME
    report_path, verify_path = output_dir / 'patch-report.json', output_dir / 'verify-report.json'
    baseline.write_bytes(data)
    patch = overlay.apply(baseline, patched, report_path, base_report)
    target = result['target_abc_sha256']
    if target is not None and patch['output_abc_sha256'] != target:
        raise ValueError('patched ABC does not match the pinned target for this base; do not use this output')
    checked = verify.verify(patched, baseline, mutants=mutants)
    verify_path.write_text(json.dumps(checked, ensure_ascii=False, indent=2, default=str) + '\n', encoding='utf8')
    if not checked['ok']:
        raise ValueError('independent verification failed; see ' + str(verify_path))
    if sha(Path(source).read_bytes()) != result['input_sha256']:
        raise ValueError('input changed while preparing the patch')
    result.update(status='prepared', output_swf=str(patched), output_swf_sha256=patch['output_sha256'],
                  output_abc_sha256=patch['output_abc_sha256'],
                  output_matches_pinned_target=None if target is None else True,
                  patch_report=str(report_path), verify_report=str(verify_path),
                  changed_methods=sorted(patch['methods']), headers=patch['headers'],
                  capabilities_added=patch['capabilities_added'],
                  candidate_capabilities=patch['candidate_capabilities'], installed=False)
    (output_dir / 'prepare-report.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--check', action='store_true', help='仅检查底包，不写文件')
    parser.add_argument('--base-build-report', type=Path,
                        help='登记表以外的底包：它的 APK 构建报告（swf_sha256 必须等于输入的主 SWF）')
    args = parser.parse_args()
    try:
        base_report = (json.loads(args.base_build_report.read_text(encoding='utf8'))
                       if args.base_build_report else None)
        result = prepare(args.input, args.output_dir, args.check, base_report=base_report)
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        parser.exit(2, f'Patch refused: {exc}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
