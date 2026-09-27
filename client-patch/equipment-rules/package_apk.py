"""把 equipment-rules 的 SWF 装进原 APK：调用 battle-rules/build_apk.py（原签名证书、保留全部非 SWF 成员），
再把它的构建报告里写死的能力声明改为「1047 客户端已有能力 + 本补丁两项」。不安装设备。

    python -X utf8 client-patch/equipment-rules/package_apk.py --base <1047.apk> --swf <equipment-rules.swf> \
        --patch-report <patch-report.json> --output <新.apk> --work <新目录> --zipalign <zipalign.exe> \
        --apksigner <apksigner.bat> --keystore <keystore> --ks-pass-env <变量名> [--key-pass-env <变量名>]

口令只经环境变量传给 apksigner；本脚本不读取、不打印、不落盘任何口令。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILD_APK = HERE.parent / 'battle-rules' / 'build_apk.py'
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import rules  # noqa: E402

SWF_MEMBER = 'assets/worldflipper_android_release.swf'
STATUS = 'static_candidate_runtime_pending'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def capabilities():
    return sorted(set(rules.INHERITED_CAPABILITIES) | {rules.CAPABILITY_RULES, rules.CAPABILITY_GAUGE})


def package(a) -> dict:
    report = json.loads(a.patch_report.read_text(encoding='utf8'))
    swf = a.swf.read_bytes()
    if report.get('patch') != 'equipment-rules' or report.get('status') != STATUS:
        raise ValueError('patch report is not an equipment-rules static candidate')
    if report.get('config') != json.loads(json.dumps(rules.DEFAULT.as_dict())):
        raise ValueError('only the DEFAULT equipment-rules configuration may be packaged')
    if sha(swf) != report['output_sha256']:
        raise ValueError('SWF does not match the patch report')
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
    if build['apk_sha256'] != sha(apk) or build['swf_sha256'] != sha(swf):
        raise ValueError('build report does not describe the produced APK')
    with zipfile.ZipFile(a.output) as archive:
        if sha(archive.read(SWF_MEMBER)) != sha(swf) or archive.testzip() is not None:
            raise ValueError('APK main SWF differs from the verified SWF')
    build['candidate_capabilities'] = capabilities()
    build['capability_notes'] = {
        rules.CAPABILITY_RULES: 'R1 PARADOX 分档 / R2 诅咒互斥：旧客户端读到分档键不崩，只是规则不生效',
        rules.CAPABILITY_GAUGE: 'R3 装备两表（ability_soul / equipment_enhancement_ability）的 during 423：'
                                '旧客户端读到即 C7050，数据必须等全员装上本 APK 后再发',
    }
    build['equipment_rules'] = {'patch_report': str(a.patch_report.resolve()),
                                'output_abc_sha256': report['output_abc_sha256'],
                                'config': report['config']}
    build_report_path.write_text(json.dumps(build, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    return build


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ('base', 'swf', 'patch-report', 'output', 'work', 'zipalign', 'apksigner', 'keystore'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--ks-pass-env', required=True)
    p.add_argument('--key-pass-env')
    a = p.parse_args()
    print(json.dumps(package(a), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
