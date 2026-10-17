"""Current dual-ABI handoff; historical SWF evidence retains its exact scope."""
import hashlib
import json
from pathlib import Path

from build_common import ROOT, write_json


def artifact(path):
    return {'path': str(path), 'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def write_report(pipeline, packages, run_directory):
    historical = ROOT / 'previous-build/arm64-versionCode1008001'
    old = json.loads((historical / 'build-report.json').read_text('utf-8'))
    tests = json.loads((ROOT / 'tests-output/summary.json').read_text('utf-8'))
    swf = artifact(ROOT / 'v34.swf')
    runtime_reused = swf['sha256'] == tests['final_swf_sha256']
    runtime_text = ('当前共用 SWF 与上一轮已验证 SWF 完全同哈希，复用 9 组／18,615 个 AIR 断言及静态测试，未重复运行未变化的夹具。'
                    if runtime_reused else '当前 SWF 已追加补丁；历史 9 组／18,615 项证据只绑定不可变 R4 基线，当前追加结果整体 AIR 验证未核实。')
    pending = [row for row in pipeline['pending']]
    variants = {}
    for variant, package in packages.items():
        variants[variant] = {
            'input': {'path': package['input_apk'], 'sha256': package['input_apk_sha256']},
            'output': artifact(ROOT / ('v34-x86-unsigned-aligned.apk' if variant == 'x86'
                                      else 'v34-arm64-unsigned-aligned.apk')),
            'abi_list': package['abi_list'], 'abi_list_basis': 'ZIP lib/<ABI>/ directory names',
            'native_library_count': len(package['libraries']),
            'android_x64_ane_platform_count': len(package['android_x64_platforms']),
            'versionCode': package['versionCode'], 'versionName': package['versionName'],
            'package_name': package['package_name'], 'unsigned': True, 'zipalign_passed': True,
            'all_dex_native_and_ane_payloads_preserved': True,
            'manifest_edit': package['version_edit'], 'application_xml_changed': False,
            'changed_payload_members': package['changed_payload_members'],
            'verification': f'verification/apk-{variant}-verification.json'}
    report = {
        'status': 'complete_unsigned_offline', 'primary_variant': 'x86', 'fallback_variant': 'arm64',
        'build_command': 'python -B scripts/build_v34.py',
        'build_run_directory': str(run_directory), 'swf': swf, 'variants': variants,
        'patch_pipeline': pipeline, 'pending_patches': pending,
        'version_policy': {'input_versionCode': 1008001, 'output_versionCode': 1008002,
                           'versionName': '1.8.1', 'application_xml_edits': [],
                           'android_manifest_edits': ['manifest/@android:versionCode:1008001->1008002'],
                           'package_air_routes_and_admission_preserved': True},
        'r4_baseline': {'sha256': '53890c19f5ced5c70ed2e327e62a8f2f800d8ce5f2fdff5f493ad5c758518642',
                        'immutable_swf': 'inputs/v34-r4-verified.swf',
                        'modules': old['r4_modules'], 'unique_methods': 47,
                        'new_helper_abcs': old['r4_new_helper_abcs'], 'new_helper_bodies': 102,
                        'composed_methods': old['composed_methods'],
                        'verification': 'verification/swf-verification.json'},
        'validation': {'apk_reports_passed': True,
                       'pipeline_guard_tests': 'verification/patch-pipeline-tests.json',
                       'x86_input_audit': 'audits/x86-input-audit.json',
                       'manifest_audit': 'audits/version-manifest.json',
                       'runtime_evidence_reused_for_identical_swf': runtime_reused,
                       'runtime_evidence': 'tests-output/summary.json',
                       'runtime_assertions_and_static_tests': tests['total_assertions_and_static_tests'],
                       'runtime_scope': tests['scope'],
                       'original_archive_method_evidence': 'verification/v33-patches-preserved.json',
                       'x86_archive_entries_97_to_100': 'preserved by x86 input and complete native/ANE member equality',
                       'device_install_and_execution': '未核实；本任务禁止执行'},
        'excluded': old['excluded'],
        'historical_outputs': str(historical.relative_to(ROOT)),
        'git': {'workspace_is_git_repository': False, 'initialized': False, 'commits': []}}
    for name, path in [('one_command_repeatability', 'verification/dual-build-repeatability.json'),
                       ('dual_apk_independent', 'verification/dual-apk-independent.json')]:
        evidence = ROOT / path
        if evidence.is_file():
            data = json.loads(evidence.read_text('utf-8'))
            observed = data.get('variants', {})
            matching = set(observed) == set(variants) and all(
                observed[key].get('sha256', observed[key].get('output_sha256')) == variants[key]['output']['sha256']
                for key in variants)
            if data.get('passed') and matching:
                report['validation'][name] = path
    write_json(ROOT / 'build-report.json', report)
    x86, arm = variants['x86'], variants['arm64']
    repeat_text = ('本次完整命令连续执行两次，两版 APK 和 SWF 哈希均相同，见 [重跑证明](verification/dual-build-repeatability.json)。'
                   if 'one_command_repeatability' in report['validation'] else '当前输入的完整命令重复构建证据尚未记录。')
    pending_text = '\n'.join(f"| {row.get('id', '')} | {row.get('description', row.get('name', '待交付补丁'))} | 待路径、源码与方法锁；未启用 |" for row in pending)
    readme = f'''# 测试服 v34-x86：双 ABI 主交付，ARM 备用

主交付为 **v34-x86**，从核对过的 v33-x86 APK 直接替换 v34 SWF，并将 versionCode 升至 **1008002**；ARM 备用从核对过的 v33 APK 生成。两份均未签名、已 zipalign，包名为 **com.leiting.wt**。

## 产物与哈希

| 用途 | 文件 | ABI 目录 | versionCode | SHA-256 |
|---|---|---|---:|---|
| 主交付 | [v34-x86-unsigned-aligned.apk](v34-x86-unsigned-aligned.apk) | arm64-v8a + x86_64 | 1008002 | `{x86['output']['sha256']}` |
| 备用 | [v34-arm64-unsigned-aligned.apk](v34-arm64-unsigned-aligned.apk) | arm64-v8a | 1008002 | `{arm['output']['sha256']}` |
| 共用 SWF | [v34.swf](v34.swf) | 共用 | — | `{swf['sha256']}` |

输入 ARM APK SHA-256：`{arm['input']['sha256']}`。输入 v33-x86 APK SHA-256：`{x86['input']['sha256']}`。两输入主 SWF 均为 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4`，每次重跑在写包前重新核对。

## 版本与身份究竟改了哪里

两份 AndroidManifest.xml 只改 `manifest/@android:versionCode` 的 typed integer data 槽：**1008001 → 1008002**，槽绝对偏移 **10976**，四字节 `81610f00 → 82610f00`，实际只有该偏移的一个字节变化。槽外 raw bytes 完全相同；aapt2 独立回读版本通过。

`versionName` 保留 **1.8.1**；`assets/META-INF/AIR/application.xml` **0 处修改**，其中 AIR id、versionNumber/versionLabel 均保留。resources.arsc、包名、AIR 身份、服务端地址和准入沿用各自基包。这里的 v34 是交付标签，没有用版本名改动触发 AIR 身份变化。

APK 唯一载荷变化为 **AndroidManifest.xml 与主 SWF**，旧签名条目及 APK 签名块移除。全部 DEX、native 库、ANE XML 和平台资源的成员载荷及压缩类型原样保留。主包保留两个 ABI 目录各 15 库，13 个 ANE Android-x64 平台的 1,938 个成员；备用保留原 ARM 目录。个别原 lib/arm64-v8a 目录成员的 ELF 架构已有例外，本次按原字节保留，ABI 清单按目录统计。证据见 [输入审计](audits/x86-input-audit.md)、[x86 输出验证](verification/apk-x86-verification.json)、[ARM 输出验证](verification/apk-arm64-verification.json)。

## R4 SWF 与原补丁保留

当前带入 6 个 R4 模块：编队动画存活、编队刷新、网络独立超时预算、数据优化（含角色徽标延迟求值）、资源优化、UI 优化。47 个唯一目标方法、5 helper ABC／102 个新方法体；42 个直接应用、5 个合成、0 个缺失依赖项。

五个合成方法为 PartyCarousel/update、CharacterTable/applyCharacters、CharacterTable/updateCells、CharacterTableView/present、CharacterTableView/applyPatch。保留 v33 current-only、线性排序、屏外省帧与无效日志求值跳过，并补入 R4 完成敏感动画与增量绑定语义。详见 [中文合成审计](audits/overlap-audit.md) 与 [最终 P-code](final-pcode/manifest.json)。全部为单方法 P-code 拼接，没有整类反编译回编替换。

已验证的 R4 基线中，原 96,733 个方法体有 96,686 个 raw 记录逐字节保留，变化集合精确等于 47 个 R4 目标；独立 FFDec 对照通过。611 个原归档方法中 606 个完整 body 相同、5 个合成。追加启用项共 {pipeline['enabled_patch_count']} 项，另见 build-report.json 的逐阶段校验。此前 ARM 范围报告中的 #97–100「不适用」只说明首轮 ARM 输入；现在主包直接保留 x86 输入中这四项的全部 native/ANE 成员，见新版 APK 验证。

StartupCache 原生 R4 改动仍未带入：wf 包名双守卫对 wt 不生效，输入也没有其 Periodic 路径；DEX 均保留原样，见 [原生审计](audits/native-audit.md)。

## 一条命令与可追加补丁列表

在本目录执行：`python -B scripts/build_v34.py`。脚本内部设置 PYTHONIOENCODING=utf-8、临时目录和工具缓存到本目录；先核对两基包，再读取 [patch-list.json](patch-list.json)，得到共用 SWF，生成两版 APK，zipalign、回读检查后更新产物与 build-report.json。重复执行会在本目录 work/release 下创建新执行记录；相同输入应输出相同哈希，不需要手工清理或覆盖工作目录。{repeat_text}

列表从已验证的不可变 `inputs/v34-r4-verified.swf` 开始。新增补丁交付后，先把源码导入本目录并审计，再填写插件路径、源码 SHA、精确输入/输出 SWF SHA、允许变化方法和 helper，最后设为 enabled。插件接口与校验规则见 [流水线源码](scripts/patch_pipeline.py)；当前待交付项不会被执行。未来 SWF 如变化，报告会明确原 AIR 证据仅绑定 R4 基线，不能自动冒称新增补丁也已通过旧夹具。

| 列表标识 | 待并入项目 | 当前状态 |
|---|---|---|
{pending_text}

这三项尚未提供目录，本次没有实现或打入。O8 若带资源成员，需要在收到目录后核对资源归属和输入/输出哈希，再加入显式成员清单；当前不猜测该范围。

## 验证、安装与归档

{runtime_text} 实际 SDK 为 51.1.4.1；R4 原 51.2.1.5 未使用，历史 R2/R3 对照未跑。详见 [测试汇总](tests-output/summary.json)。两 APK 的成员、ABI、版本、对齐及无签名检查为本次重新执行。

**Android 安装、完整游戏场景与设备性能未核实。** 本任务不联网，不接触服务器/SSH/禁止目录，不运行模拟器/adb，不安装，不签名或读取 keystore。签名由另一个线程负责；签名后测试需清旧 AIR 提取缓存 cache/app，或清除应用数据／卸载重装，不能只靠升 versionCode 判断新 SWF 已生效。

新增 R4 归档草稿 [102–107](apk-patches-additions/README.md) 保留；三项待并入补丁待实际交付后另补归档。首轮 versionCode 1008001 的 ARM 成品与报告移入 [previous-build/arm64-versionCode1008001](previous-build/arm64-versionCode1008001/)，不作为当前交付。完整输入/输出哈希、版本、ABI 及流水线状态见 [build-report.json](build-report.json)。当前目录非 Git 仓库，未初始化或向外部仓库提交。
'''
    (ROOT / 'README.md').write_text(readme, encoding='utf-8')
    return report
