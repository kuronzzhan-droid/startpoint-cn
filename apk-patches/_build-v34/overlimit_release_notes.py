"""Chinese release notes for the capability-gated O9-O12 r2 fixes."""
from build_common import ROOT


def update_notes(report, replay, audit):
    sha = report['swf']['sha256']
    text = (ROOT / 'README.md').read_text('utf-8')
    start = text.index('## 一条命令与可追加补丁列表')
    end = text.index('## 验证、安装与归档')
    section = f'''## O8–O12 r2：仅可超限角色启用悖论之核逻辑

本轮使用 r2 共享 `v34_patches.py`，SHA-256 `{replay['source_sha256']}`。外来原编号 102–105 对应本目录 [108–111](apk-patches-additions/README.md)，首发均为 v34；109/110/111 修订为 r2，108/O8 方法体不变，只同步共享来源。旧源与旧归档保留在 previous-build/round5-sources/，外来目录始终只读。**旧 r1 O9–O12 已废弃，当前构建只使用 r2。**

r1 只判断五星且突破步数≥4，误把不能超限的普通五星也当成超限角色。r2 在 O9、O10、O11、O12 四个方法中统一增加 **`get_maxOverLimitStep() > 4`**；完整条件为 `rarity==5 && overLimitStep>=4 && get_maxOverLimitStep()>4`。最大步数≤4 的角色走原路径：不额外加核心槽、不拼核心文案、不因缺核心额外锁按钮；已达原上限时按钮仍按原规则置灰。

| 补丁 | 唯一目标方法 | 行为 |
|---|---|---|
| [O8 / 108](apk-patches-additions/108-overlimit-owned-pedestal/README.md) | PixelArtCharacter/getPedestalImagePath | 持有角色按本账号突破阶段显示台座，空 player／未持有仍走原分支 |
| [O9 / 109 r2](apk-patches-additions/109-overlimit-paradox-core-gate/README.md) | OverLimitWindow/getOverLimitState | 仅可超限模式核不足时禁止确认 |
| [O10 / 110 r2](apk-patches-additions/110-overlimit-two-cost-slots/README.md) | OverLimitWindow/run | 仅可超限模式追加核心格，并注册道具详情按钮 |
| [O11 / 110 r2](apk-patches-additions/110-overlimit-two-cost-slots/README.md) | OverLimitWindow/getStatusInformation | 仅可超限模式显示两格，各显示持有数，0 个置灰 |
| [O12 / 111 r2](apk-patches-additions/111-overlimit-dialog-paradox-text/README.md) | ExpodOverLimitByItemDialog/getDescription | 仅可超限模式将道具名拼为「超限结晶＋悖论之核」 |

O12 在满足上述完整条件时，从道具表读取核心名，与原结晶名及主 ABC 已有全角「＋」拼接；数量与模板沿用原逻辑。数量为 1 时，确认文案为「确定要消耗1个超限结晶＋悖论之核吗？」。普通突破保持原文，不改共享文案键或数据。四个 r2 最终方法体 code SHA-256 独立核对如下：

| 方法 | r2 after SHA-256 |
|---|---|
| O9 | `{report['method_sha256_pins']['O9']['code_sha256']}` |
| O10 | `{report['method_sha256_pins']['O10']['code_sha256']}` |
| O11 | `{report['method_sha256_pins']['O11']['code_sha256']}` |
| O12 | `{report['method_sha256_pins']['O12']['code_sha256']}` |

R4 的 47 个目标中没有任何 `OverLimitWindow` 或 `ExpodOverLimitByItemDialog` 方法。五个追加方法彼此互异，均与 R4 47 目标、5 个既有合成及原 101 条映射的 611 方法无交集，方法锁全部命中，**无需新增合成**。全部只做单方法 P-code 拼接，不追加常量池、字段或 traits。

O10/O11 仅可超限模式显示两格；普通模式、各自库存、0 灰及原生 `33554432 + itemId` 详情路由保留。突破判定仍由原 101 与 O9 r2 决定。O8 仍按来源设计：别人的同一角色也会按本账号持有角色的突破阶段显示台座。

## 一条命令与正式方案

运行 `python -B scripts/build_v34.py`，从固定 R4 基线按 [patch-list.json](patch-list.json) 顺序应用 O8→O9 r2→O10 r2→O11 r2→O12 r2，生成 `v34.swf` 与两版未签名、zipalign APK，versionCode 均为 **1008002**。当前共用 SWF SHA-256：`{sha}`。补丁列表可追加，需导入源码、固定源码及输入/输出哈希、声明目标方法并通过流水线范围检查。

**零消耗方案已取消，O9 与原归档 101 保留。** `--without-O9` 仅作显式历史诊断，使用独立 [配置](patch-list-without-O9.json)，只生成 diagnostics/v34-without-O9.swf；不生成 APK，不改主 SWF／报告／APK，不是候选交付，也不是完整零核版本。默认不生成该变体。凉月觉醒入口属于数据边，本次不改。

## 本轮重新验证

- v33 控制重放得到 `{replay['v33_control']['output_sha256']}`，符合 `e30172b3…`；R4＋O8–O12 r2 得到当前 `{sha}`。五项再次应用均 already_present，输出逐字节相同，见 [重放与幂等报告](work/overlimit-round6/source-replay-verification.json)。
- 原 101 条重新核验：611 个归档方法＝606 个完整 body 保留＋5 个既有 R4 合成，零失败。相对 v33 只变 **52** 个目标（R4 47＋O8–O12 5），其余 **96,681** 个原方法记录逐字节相同；5 个 R4 helper／102 个新方法体保留。
- 与固定 R4 相比只变五个追加目标；与第五轮 r1 相比只变 O9–O12，O8 及 R4 所有目标保持原样。类布局、签名、既有常量池及非 ABC tag 保留。独立 FFDec 全量比较及四个 r2 code SHA 锁通过，见 [全 SWF 报告](verification/swf-o8-o12-r2-verification.json) 与 [原 101 报告](verification/v33-patches-preserved-o8-o12-r2.json)。
- **{audit['total_cases']}** 个解码生产字节码用例、**{audit['negative_controls']}** 个负例通过，覆盖旧行为、maxStep≤4 普通五星原路径、maxStep>4 可超限分支、数量及道具名，见 [来源审计](audits/round6-source-audit.md) 与 [语义探针](audits/round6-bytecode-probes.json)。类型／主表值使用受控夹具，整体 AIR／Android 设备运行**未核实**。

'''
    text = text[:start] + section + text[end:]
    text = text.replace('新增 R4 归档草稿 [102–107](apk-patches-additions/README.md) 保留；三项待并入补丁待实际交付后另补归档。',
                        '新增归档草稿 [102–111](apk-patches-additions/README.md) 已更新，109/110/111 为 r2，首发仍为 v34；108/O8 方法体不变。')
    validation = report['validation']
    if 'one_command_repeatability' in validation:
        text += '\n本轮完整默认命令已连续运行两次，两 APK 与 SWF 均逐字节相同，见 [重复构建证明](verification/dual-build-repeatability.json)。\n'
    if 'dual_apk_independent' in validation:
        text += '\n两 APK 通过 [独立全成员读回](verification/dual-apk-independent.json)，包括原压缩字节、全部 stored 成员对齐、aapt2 版本与无签名检查。\n'
    if 'historical_diagnostic_switch' in validation:
        text += '\n历史诊断开关 [副作用检查](verification/round6-diagnostic-switch.json) 通过；诊断 SHA-256 `' + report['o9_policy']['diagnostic_expected_sha256'] + '`，不是候选交付。\n'
    text += '\n第五轮 r1 成品、报告及旧诊断 SWF 保留在 previous-build/round5-o8-o12-r1-versionCode1008002/，旧 O9–O12 不再作为当前交付。\n'
    (ROOT / 'README.md').write_text(text, encoding='utf-8')
