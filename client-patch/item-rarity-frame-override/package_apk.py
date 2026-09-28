"""把 item-rarity-frame-override 的 SWF 装回它的底包 APK：调用 battle-rules/build_apk.py（原签名证书、保留全部非
SWF 成员与压缩方式），再把构建报告里写死的能力声明改为「底包声明的能力 + item-rarity-frame-override-v1」。不安装设备。

    python -X utf8 client-patch/item-rarity-frame-override/package_apk.py --base <底包.apk> \\
        --swf <item-rarity-frame-override.swf> --patch-report <patch-report.json> --output <新.apk> \\
        --work <新目录> --zipalign <zipalign.exe> --apksigner <apksigner.bat> --keystore <keystore> \\
        --ks-pass-env <变量名> [--key-pass-env <变量名>]

拒绝条件（签名前）：补丁报告不是本补丁、SWF 与报告不符、SWF 的主 ABC 与报告不符、登记底包的产物 ABC 不是钉住的目标、
底包 APK 不是补丁报告记下的那个底包（登记表里的 APK 哈希，或底包构建报告里的 apk_sha256；中间层 22292c21 没有 APK，
不能打包）、底包里的主 SWF 不是当初打补丁的那份。拒绝条件（签名后、改写构建报告前）：产物证书不是 729507c1…（无开关）；
此时构建报告被标成 refused，防止误装。口令只经环境变量传给 apksigner；本脚本不读取、不打印、不落盘任何口令。
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILD_APK = HERE.parent / 'battle-rules' / 'build_apk.py'


def _load(name, path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


overlay = _load('item_rarity_frame_override_overlay', HERE / 'overlay.py')
rules = overlay.rules

SWF_MEMBER = 'assets/worldflipper_android_release.swf'
STATUS = overlay.STATUS
#: 本机已装客户端（14396ce0）与全部候选底包共用的签名证书（覆盖安装 pm install -r 的前提）。
CERTIFICATE_SHA = '729507c10a893879b14f46cf81d8e5052d4b66c2c081fa5b9f915a142a827a0b'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main_abc_sha(swf_bytes: bytes) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 'member.swf'
        path.write_bytes(swf_bytes)
        return sha(overlay.SwfAbc(path).abc.serialize())


def check_inputs(a) -> dict:
    """调用签名工具之前的全部拒绝条件；返回补丁报告。"""
    report = json.loads(a.patch_report.read_text(encoding='utf8'))
    swf = a.swf.read_bytes()
    if report.get('patch') != overlay.PATCH_NAME or report.get('status') != STATUS:
        raise ValueError('patch report is not an item-rarity-frame-override static candidate')
    if sha(swf) != report.get('output_sha256'):
        raise ValueError('SWF does not match the patch report')
    if main_abc_sha(swf) != report.get('output_abc_sha256'):
        raise ValueError('SWF main ABC does not match the patch report')
    base = report.get('base') or {}
    listed = rules.KNOWN_BASES.get(report.get('source_abc_sha256'))
    if base.get('listed'):
        if listed is None or report.get('output_abc_sha256') != listed['target_abc_sha256']:
            raise ValueError('only the pinned target ABC of a listed base may be packaged')
        base_apk = listed['apk_sha256']
    else:
        if listed is not None:
            raise ValueError('patch report claims an unlisted base for a listed ABC')
        base_apk = base.get('apk_sha256')
    if not base_apk:
        raise ValueError('this base has no APK of its own (intermediate layer); patch the final stack instead')
    if sorted(report.get('candidate_capabilities') or []) != sorted(set(base.get('capabilities') or [])
                                                                     | {rules.CAPABILITY}):
        raise ValueError('candidate capabilities in the patch report are not base + ' + rules.CAPABILITY)
    with zipfile.ZipFile(a.base) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or names.count(SWF_MEMBER) != 1:
            raise ValueError('base APK contains duplicate entries or lacks the main SWF')
        base_swf = archive.read(SWF_MEMBER)
    if sha(a.base.read_bytes()) != base_apk:
        raise ValueError('base APK is not the APK recorded for this base (' + base_apk[:8] + '...)')
    if sha(base_swf) != report.get('source_sha256'):
        raise ValueError('base APK main SWF is not the SWF the patch was applied to (patch-report source_sha256)')
    return report


def package(a) -> dict:
    report = check_inputs(a)
    swf = a.swf.read_bytes()
    base_sha = sha(a.base.read_bytes())
    args = [sys.executable, '-X', 'utf8', str(BUILD_APK)]
    for name, value in (('base', a.base), ('swf', a.swf), ('patch_report', a.patch_report), ('output', a.output),
                        ('work', a.work), ('zipalign', a.zipalign), ('apksigner', a.apksigner),
                        ('keystore', a.keystore)):
        args += ['--' + name.replace('_', '-'), str(value)]
    args += ['--ks-pass-env', a.ks_pass_env]
    if a.key_pass_env:
        args += ['--key-pass-env', a.key_pass_env]
    result = subprocess.run(args, capture_output=True, text=True, encoding='utf8', errors='replace')
    if result.returncode:
        # build_apk.py 自己不回显签名命令输出；这里只转述它的错误摘要。
        tail = (result.stderr or result.stdout).strip().splitlines()[-1:] or ['(no output)']
        raise RuntimeError('battle-rules/build_apk.py failed: ' + tail[0])
    build_report_path = a.output.with_suffix('.build-report.json')
    build = json.loads(build_report_path.read_text(encoding='utf8'))
    apk = a.output.read_bytes()
    if build['apk_sha256'] != sha(apk) or build['swf_sha256'] != sha(swf) or build['base_sha256'] != base_sha:
        raise ValueError('build report does not describe the produced APK')
    if build.get('certificate_sha256') != [CERTIFICATE_SHA]:
        # build_apk 只保证「产物签名者 == 底包签名者」；这里再钉死到已安装客户端的证书。
        build['status'] = 'refused_certificate_mismatch'
        build['installed'] = False
        build_report_path.write_text(json.dumps(build, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
        raise ValueError('candidate certificate is not the installed client certificate 729507c1...; do not install')
    with zipfile.ZipFile(a.output) as archive:
        member = archive.read(SWF_MEMBER)
        if sha(member) != sha(swf) or archive.testzip() is not None:
            raise ValueError('APK main SWF differs from the verified SWF')
    member_abc = main_abc_sha(member)
    if member_abc != report['output_abc_sha256']:
        raise ValueError('APK main ABC is not the verified patch output')
    build['candidate_capabilities'] = sorted(report['candidate_capabilities'])
    build['capability_notes'] = {
        rules.CAPABILITY: '物品品质底色覆盖（custom_ability_string 的 rarity_frame_override_<图标路径> 行）：'
                          '旧客户端读不到，显示原生稀有度底色、不崩 —— 数据可以先于 APK 发布（cosmetic）',
    }
    build['item_rarity_frame_override'] = {
        'patch_report': str(a.patch_report.resolve()),
        'base': report['base'],
        'base_swf_sha256': report['source_sha256'],
        'base_abc_sha256': report['source_abc_sha256'],
        'output_abc_sha256': report['output_abc_sha256'],
        'apk_member_abc_sha256': member_abc,
        'certificate_matches_installed': build['certificate_sha256'] == [CERTIFICATE_SHA],
        'changed_methods': sorted(report.get('methods', {})),
    }
    build_report_path.write_text(json.dumps(build, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    return build


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ('base', 'swf', 'patch-report', 'output', 'work', 'zipalign', 'apksigner', 'keystore'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--ks-pass-env', required=True)
    p.add_argument('--key-pass-env')
    a = p.parse_args()
    try:
        build = package(a)
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as exc:
        p.exit(2, f'Packaging refused: {exc}\n')
    print(json.dumps(build, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
