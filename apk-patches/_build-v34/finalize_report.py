"""Bind final offline evidence, unsigned artifacts, and Chinese handoff notes."""
import hashlib
import json
from pathlib import Path

from build_common import ROOT, PATCH, SDK, JAVA, FFDEC, ZIPALIGN, load, write_json


def read(name):
    return json.loads((ROOT / name).read_text('utf-8'))


def artifact(name):
    p = ROOT / name
    return {'path': str(p), 'bytes': p.stat().st_size,
            'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}


def raw_tag_proof():
    # Cheap direct SWF-tag pass supplements both full ABC parsers.
    s = load('finalize_swf_support', PATCH / 'startup-cache/build_swf.py')
    def tags(path):
        _, _, _, raw = s.swftags.load_swf(str(path))
        result = []
        for code, at, header, size in s.swftags.iter_tags(raw):
            data = raw[at + header:at + header + size]
            if code == 82:
                name = data[4:data.index(b'\0', 4)].decode()
                result.append((name, raw[at:at + header + size]))
        return result
    old = tags(ROOT / 'inputs/v33.swf')
    expected = set(read('r4-src/client-patch/client-comprehensive/r4-expected.json')['helpers'])
    new = [tag for tag in tags(ROOT / 'v34.swf') if tag[0] not in expected]
    assert len(old) == len(new) == 302
    assert [x[0] for x in old] == [x[0] for x in new]
    assert [x[0] for x, y in zip(old, new) if x != y] == ['boot_ffc6']
    return {'passed': True, 'original_abc_tags': 302,
            'byte_identical_original_abc_tags': 301, 'changed_original_abc': ['boot_ffc6']}


def main():
    swf, apk = read('verification/swf-verification.json'), read('verification/apk-verification.json')
    tests = read('tests-output/summary.json')
    archive = read('verification/v33-patches-preserved.json')
    overlap = read('audits/overlap-audit.json')
    assert swf['passed'] and apk['passed'] and tests['passed']
    assert read('verification/stage-final-equivalence.json')['passed']
    assert not archive['method_evidence_failures']
    raw = raw_tag_proof()
    write_json(ROOT / 'verification/raw-abc-tag-comparison.json', raw)
    swf['unrelated_original_abc_tags_byte_identical'] = 301
    write_json(ROOT / 'verification/swf-verification.json', swf)
    modules = []
    specs = [('liveness', 'party-animation-liveness', 'work/after-liveness.json', 1),
             ('refresh', 'party-refresh-performance', 'work/after-refresh.json', 1),
             ('network', 'client-network-optimization', 'work/after-network.json', 4),
             ('data', 'client-data-optimization', 'work/after-data.json', 11),
             ('resource', 'client-resource-optimization', 'work/after-resource.json', 23),
             ('ui', 'client-ui-optimization', 'v34.json', 8)]
    for name, folder, path, count in specs:
        stage = read(path)
        modules.append({'name': name, 'source_module': 'client-patch/' + folder,
                        'status': 'applied_and_verified_offline', 'edited_methods': count,
                        'input_swf_sha256': stage['input_swf_sha256'],
                        'output_swf_sha256': stage.get('swf_sha256', stage.get('output_swf_sha256')),
                        'report': path})
    native_reason = ('v33 DEX 与 R4 Java 均有 com.leiting.wf 双重守卫，对 com.leiting.wt 不生效；'
                     'v33 未含 Periodic/periodicPurge，亦不存在此次 R4 修复的十分钟实时清缓存路径。'
                     '原生整类重编/重组 DEX 超出本次仅单方法 P-code 的边界，保持原 DEX。')
    compositions = read('work/manual-compositions.json')
    compositions.insert(0, {'method': 'pinball.scene.character.partyCarousel::PartyCarousel/update|1',
                           'body': 66361, 'v33_archive': 18, 'insertion_reversible': True,
                           'logic': 'R4 原锁精确命中 v33 current-only 方法；仅等待入退场时推进已有且需完成的屏外动画。',
                           'report': 'work/after-liveness.json'})
    report = {
        'status': 'complete_unsigned_offline', 'date': '2026-10-16',
        'inputs': {'apk': {'path': r'D:\WF\MuMuPlayer\vms\MuMuPlayer-15.0-1\private_shared\wt_v33.apk',
                           'sha256': apk['input_apk_sha256']},
                   'swf': artifact('inputs/v33.swf'),
                   'r4_source': {'git_ref': read('audits/source-provenance.json')['offline_git_ref'],
                                 'manifest': 'audits/source-provenance.json'}},
        'outputs': {'swf': artifact('v34.swf'), 'apk': artifact('v34-unsigned-aligned.apk')},
        'r4_modules': modules, 'r4_unique_target_methods': 47, 'r4_stage_edits': 48,
        'r4_new_helper_abcs': swf['helpers'], 'r4_new_helper_method_bodies': 102,
        'target_classification': overlap['category_counts_unique'],
        'composed_methods': compositions,
        'excluded': [{'module': 'StartupCache native/DEX', 'reason': native_reason,
                      'evidence': 'audits/native-audit.json'}],
        'identity': {k: apk[k] for k in ('package_name', 'versionCode', 'versionName',
            'versionCode_unchanged', 'manifest_resources_air_identity_unchanged',
            'all_dex_and_native_unchanged', 'changed_payload_members', 'unsigned', 'zipalign_passed')},
        'verification': {'swf': 'verification/swf-verification.json',
            'tested_stage_bytes': 'verification/stage-final-equivalence.json',
            'apk': 'verification/apk-verification.json',
            'archive_101': 'verification/v33-patches-preserved.json',
            'tests': tests, 'independent_review': 'audits/final-review.json',
            'original_method_bodies': 96733, 'unchanged_raw_method_bodies': 96686,
            'archive_methods': 611, 'archive_unchanged_methods': 606,
            'archive_composed_methods': 5, 'raw_abc_tags': raw},
        'tools': {'air_sdk': str(SDK), 'air_sdk_actual_version': '51.1.4 build 1',
            'air_sdk_r4_version': '51.2.1.5 (not located or used in this task)', 'java': str(JAVA),
            'ffdec': str(FFDEC), 'zipalign': str(ZIPALIGN),
            'compiler_adjustment': 'SDK 51.1 反向输出网络两个 helper；严格校验集合后恢复 R4 规定顺序。DataOptimization helper 与 R4 锁 SHA 完全相同。'},
        'unverified': ['Android 安装/启动/真机/模拟器/完整游戏与设备性能未核实，任务禁止执行。',
                       'R4 原 SDK 51.2.1.5 未使用；本次夹具使用本机 AIR 51.1.4.1。',
                       '缺少历史 R2/R3 SWF，不执行历史版本性能对照；实际 v33/final 语义已测。'],
        'archive_additions': 'apk-patches-additions/README.md',
        'git': {'workspace_is_git_repository': False, 'initialized': False, 'commits': []},
    }
    assert report['outputs']['swf']['sha256'] == swf['swf_sha256'] == apk['swf_sha256']
    assert report['outputs']['apk']['sha256'] == apk['apk_sha256']
    write_json(ROOT / 'build-report.json', report)
    test_rows = '\n'.join(f"| {c['name']} | {'通过' if c['passed'] else '失败'} | {c.get('assertions', '见报告')} | {c.get('scenarios') or '—'} |" for c in tests['cases'])
    text = f'''# 测试服客户端 v34：v33 + R4 SWF 修复

已完成离线构建与验证，产物未签名、已 zipalign。输入为指定测试者 v33，包名 **com.leiting.wt**。
带入 R4 的 **6 个 SWF 模块、47 个唯一目标方法、5 个 helper ABC（102 个新方法体）**。阶段共编辑 48 次，因为 PartyTranslator/translate 先后承载 refresh/data 两项改动。

## 产物与身份

| 文件 | SHA-256 |
|---|---|
| [v34-unsigned-aligned.apk](v34-unsigned-aligned.apk) | `{apk['apk_sha256']}` |
| [v34.swf](v34.swf) | `{swf['swf_sha256']}` |
| 输入 v33 APK | `{apk['input_apk_sha256']}` |
| 输入 v33 SWF | `{swf['baseline_sha256']}` |

Manifest、resources.arsc、AIR application.xml、所有 DEX/原生库和其它资源逐字节保留。versionCode **{apk['versionCode']}**、versionName **{apk['versionName']}** 与 v33 相同，没有降级。服务端地址、AIR 身份、准入相关全部既有 ABC/方法/常量保持不变。APK 唯一载荷变化为主 SWF；旧签名条目与签名块不带入新包。此输入没有独立 uniqueappversionid 文件，不新增或改写该身份。

## 带入的 R4 内容

| 模块 / 新归档编号 | 方法编辑数 | 内容 |
|---|---:|---|
| liveness / 102 | 1 | 等待编队入退场时推进必要屏外动画，避免等待无法完成 |
| refresh / 103 | 1 | 精确条件下复用同一次编队能力汇总，保留其它状态回退 |
| network / 104 | 4 | 请求独立超时预算、重试剩余时间及 AIR Timer 计时 |
| data / 105 | 11 | 排序与编队数据复用、局部能力节点缓存、角色徽标延迟求值 |
| resource / 106 | 23 | 文件流/多任务调度、资源拥有者取消、纹理上传与恢复的存活性边界 |
| ui / 107 | 8 | 角色表增量绑定、动画池、屏外更新与编队页绘制优化 |

逐个分类为 **42 个 (a) 直接应用、5 个 (b) 合成、0 个 (c) 缺失上游依赖**；真正只读的依赖方法锁均命中。详见 [逐方法审计](audits/overlap-audit.md) 和 [JSON](audits/overlap-audit.json)。

## 五个合成方法

- `PartyCarousel/update`（旧 #18）：v33 方法 SHA 精确命中 R4 原锁。稳定态仍仅更新当前队伍；等待入退场时才推进已初始化、正在加入/退出的屏外容器，不初始化闲置队伍。原完成谓词及回调保留。
- `CharacterTable/applyCharacters`（旧 #63）：保留 v33 可见集合与正常线性重排；仅长度异常的排序 fallback 改用 R4 ranks/rankComparator，避免重复 indexOf。原比较器字节可逆保留。
- `CharacterTable/updateCells`（旧 #62）：先保留 z/alpha 同步，再由 R4 shouldUpdateCell 决定更新或继续循环；稳定远屏仍省帧，完成敏感状态继续更新。旧 guard 字节可逆保留，新路径绕过其中 19 条旧指令，避免旧 guard 再吞掉待完成动画。
- `CharacterTableView/present`（旧 #67）：加入 R4 增量绑定 hook，保留 v33 日志求值跳过与正常回退。
- `CharacterTableView/applyPatch`（旧 #67）：先失效 R4 行快照，再执行 v33 原正文。旧 #60 的 draw 三格分帧方法原样保留。

合成全部通过单方法 P-code 拼接，原始代码可由 unsplice 完整还原。既有类的字段、traits、方法签名不改，常量池只追加；资源 donor 仅提取具名方法体，没有整类回编替换。见 [合成器](scripts/compose_conflicts.py)、[独立检查](audits/composition-check.json) 与最终 [P-code](final-pcode/manifest.json)。

## 未带项目

**StartupCache 原生改动未带：**{native_reason} 证据见 [原生审计](audits/native-audit.md)。

归档 #97–100 是后续 v33-x86 双 ABI 变体，当前指定 v33 输入本身没有这些项目，本次未追加 x86 库或 ANE 平台。

## 验证结果与边界

全 **96,733 个原方法体**中，**96,686 个 raw 方法记录逐字节相同**，变化集合精确等于 R4 的 47 个目标；5 个新 helper 共 102 方法体。独立 FFDec 与 Python 解析结果一致。原 302 个 ABC 中，301 个原 tag 整体逐字节相同，只有 boot_ffc6 改动；非 ABC tag 原样保留。

101 条归档全部盘点：611 个唯一归档方法中 606 个完整 body 相同、5 个允许合成；90 条原样、4 条含合成、3 条纯资源由最终 APK 成员比较证明、4 条 x86 变体不适用。见 [归档保留证明](verification/v33-patches-preserved.json)、[全 SWF 验证](verification/swf-verification.json)、[APK 验证](verification/apk-verification.json)。

| 测试 | 结果 | 断言 | 场景 |
|---|---|---:|---:|
{test_rows}

本机实际使用 **AIR SDK 51.1.4.1**，本次在本机工具候选路径中未找到 R4 原构建 SDK 51.2.1.5，未使用该版本。网络 helper 的编译 tag 顺序经严格集合校验后恢复 R4 原顺序；DataOptimization helper 与 R4 原锁 SHA 完全相同。实际 v33/final 夹具包含生产 helper/方法及受控依赖；缺少历史 R2/R3 SWF，历史对照没有运行。共 9 组、18,615 个 AIR 断言与静态测试通过，完整边界见 [测试汇总](tests-output/summary.json)。分阶段受测方法/helper 保留到最终包的字节证明见 [阶段比较](verification/stage-final-equivalence.json)。

**Android 安装、启动、完整游戏场景、设备性能和真机接受度均未核实。** 本任务未联网、未接触服务器/SSH/禁止目录、未启动模拟器/adb、未安装、未签名、未读取 keystore。当前目录不是 Git 仓库，未初始化仓库或提交外部仓库。

## 安装注意

本包未签名，交由其它线程签名后再测试。覆盖安装时，AIR 可能继续使用旧的已提取 SWF；versionCode 或 APK 已变并不能证明提取缓存已更新。测试者需清理旧 AIR 提取缓存（cache/app），或清除应用数据/卸载重装后再验收。单纯重新打开游戏不构成新 SWF 已生效的证据。

## 构建与归档入口

本次实际入口为 `scripts/build_initial.py` → `scripts/build_remaining.py` → `scripts/verify_swf_v34.py` → `scripts/package_unsigned.py`，使用 Windows `python -B`，`PYTHONIOENCODING=utf-8`。脚本默认拒绝覆盖已有产物；当前结果与失败后已解决的编译顺序记录保存在 work/logs 内。源码从本机 Git `origin/main` 导出，固定提交 `{report['inputs']['r4_source']['git_ref']}`，247 份导出逐份与该提交核对，见 [来源清单](audits/source-provenance.json)。

新增条目草稿 [apk-patches-additions/README.md](apk-patches-additions/README.md) 编号 102–107，含最终逐方法 P-code、helper 文本、源码与来源哈希，供后续并入原归档；此次没有写入原归档。总报告见 [build-report.json](build-report.json)。
'''
    (ROOT / 'README.md').write_text(text, encoding='utf-8')
    print(json.dumps({'status': report['status'], 'outputs': report['outputs']}, indent=2))


if __name__ == '__main__':
    main()
