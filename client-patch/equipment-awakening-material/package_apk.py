"""把 equipment-awakening-material 的 SWF 装进 equipment-enhanced-party-frame APK：调用 battle-rules/build_apk.py
（原签名证书、保留全部非 SWF 成员与压缩方式），再把构建报告里写死的能力声明改为
「equipment-enhanced-party-frame 的 12 项 + equipment-awakening-material-v1」。不安装设备。

只打本补丁时用这个脚本；与 equipment-sort-pin 叠成一个 APK 时用 ``equipment-sort-pin/package_apk.py --stack-report``。

    python -X utf8 client-patch/equipment-awakening-material/package_apk.py --base <2f085757.apk> \
        --swf <equipment-awakening-material.swf> --patch-report <patch-report.json> --output <新.apk> \
        --work <新目录> --zipalign <zipalign.exe> --apksigner <apksigner.bat> --keystore <keystore> \
        --ks-pass-env <变量名> [--key-pass-env <变量名>] [--allow-foreign-base]

拒绝条件（签名前）：补丁报告不是本补丁、ABC 不是锁定目标、SWF 与报告不符、底包里的 SWF 不是当初打补丁的那份；
底包不是 equipment-enhanced-party-frame b 版 APK 2f085757（除非显式 --allow-foreign-base；那样产物不保证带着 b 版的
图标修复）。拒绝条件（签名后、改写构建报告前）：产物证书不是 729507c1…（无开关）；
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


overlay = _load('equipment_awakening_material_overlay', HERE / 'overlay.py')
rules = overlay.rules

SWF_MEMBER = 'assets/worldflipper_android_release.swf'
STATUS = overlay.STATUS
TARGET_ABC_SHA = '22292c21361fa505bccd563852810e6fb1d696ae03823f05ff694a74fbdf2ec1'
#: 底包 = equipment-enhanced-party-frame b 版 APK（修掉 a 版 14396ce0 的「武器图标会消失」）；签名证书与本机已装的
#: 14396ce0 相同（pm install -r 覆盖安装的前提）。
BASE_APK_SHA = '2f085757e46477625727fc5eb135027d15c14bb54e3486a395a730ed3f168666'
CERTIFICATE_SHA = '729507c10a893879b14f46cf81d8e5052d4b66c2c081fa5b9f915a142a827a0b'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def capabilities():
    return sorted(set(rules.INHERITED_CAPABILITIES) | {rules.CAPABILITY})


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
        raise ValueError('patch report is not an equipment-awakening-material static candidate')
    if report.get('output_abc_sha256') != TARGET_ABC_SHA:
        raise ValueError('only the verified target ABC may be packaged')
    if sha(swf) != report.get('output_sha256'):
        raise ValueError('SWF does not match the patch report')
    with zipfile.ZipFile(a.base) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or names.count(SWF_MEMBER) != 1:
            raise ValueError('base APK contains duplicate entries or lacks the main SWF')
        base_swf = archive.read(SWF_MEMBER)
    if sha(base_swf) != report.get('source_sha256'):
        raise ValueError('base APK main SWF is not the SWF this patch was applied to '
                         '(patch-report source_sha256); apply the patch to this APK first')
    if sha(a.base.read_bytes()) != BASE_APK_SHA and not getattr(a, 'allow_foreign_base', False):
        raise ValueError('base APK is not the equipment-enhanced-party-frame b build 2f085757; the candidate would '
                         'not carry the b icon fix (pass --allow-foreign-base to override)')
    return report


def package(a) -> dict:
    report = check_inputs(a)
    swf = a.swf.read_bytes()
    base_sha = sha(a.base.read_bytes())
    args = [sys.executable, '-X', 'utf8', str(BUILD_APK)]
    for name in ('base', 'swf', 'patch_report', 'output', 'work', 'zipalign', 'apksigner', 'keystore'):
        args += ['--' + name.replace('_', '-'), str(getattr(a, name))]
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
    if member_abc != TARGET_ABC_SHA:
        raise ValueError('APK main ABC is not the verified target')
    build['candidate_capabilities'] = capabilities()
    build['capability_notes'] = {
        rules.CAPABILITY: '觉醒专属素材（custom_ability_string 的 awakening_material_<装备ID> 行）：旧客户端读不到这些行，'
                          '重复数为 0 时仍按稀有度提供星铁钢，服务端白名单返回 400（静默失效，semantic）',
    }
    build['equipment_awakening_material'] = {
        'patch_report': str(a.patch_report.resolve()),
        'source_swf_sha256': report['source_sha256'],
        'output_abc_sha256': report['output_abc_sha256'],
        'apk_member_abc_sha256': member_abc,
        'base_apk_is_party_frame_b': base_sha == BASE_APK_SHA,
        'certificate_matches_installed': build['certificate_sha256'] == [CERTIFICATE_SHA],
        'changed_methods': sorted(report['methods']),
    }
    build_report_path.write_text(json.dumps(build, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    return build


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ('base', 'swf', 'patch-report', 'output', 'work', 'zipalign', 'apksigner', 'keystore'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--ks-pass-env', required=True)
    p.add_argument('--key-pass-env')
    p.add_argument('--allow-foreign-base', action='store_true',
                   help='package onto a base APK other than the equipment-enhanced-party-frame b build 2f085757')
    a = p.parse_args()
    try:
        build = package(a)
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as exc:
        p.exit(2, f'Packaging refused: {exc}\n')
    print(json.dumps(build, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
