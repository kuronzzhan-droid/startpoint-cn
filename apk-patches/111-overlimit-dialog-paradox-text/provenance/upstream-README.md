# 105 超限确认框文案写上悖论之核（O12）

超限模式下，上限突破确认框从「确定要消耗1个超限结晶吗？」改为「确定要消耗1个超限结晶＋悖论之核吗？」。

- 首发 APK 版本：**v34**（叠在 v33 上）。作者 1017「加上」。
- 改动位置：`ExpodOverLimitByItemDialog/getDescription`（主 ABC `boot_ffc6`）。
- 做法：文案键 `overlimit_by_item_dialog_description`（「确定要消耗{value}个{itemName}吗？」）是所有突破结晶共用的，不改数据；只在目标角色 ★5 且 `overLimitStep ≥ 4` 时，把传入的 `itemName` 换成「超限结晶名 + ＋ + 悖论之核名」。悖论之核名用 `globalLogic.getItem(10000302).get_name()` 从道具表取，「＋」是主 ABC 已有字符串，不追加常量池。普通 ★1–5 突破不受影响。
- 依赖：无（与 101/103/104 配套）。若以后改成零核，本条随 101/103/104 一起撤。不碰 `PartyCarousel/update`。

## 方法体

| | header | code SHA-256 |
|---|---|---|
| v33 原 | [6, 2, 1, 2] | `479e1323bda6560e5033a2f4d303e2932412d19c39b340844ecfb9a2d46fbbec` |
| 打后 | [9, 2, 1, 2] | `a0468818a62ad753f0d18a755b29af19c61ebf5c3cd4a145c7a5a8cfc8a8be55` |

P-code 见 [pcode/](pcode/)。脚本同 102–104：`python source/apply.py IN.swf OUT.swf O12` 只打本条。

## 自测

- 静态：v33 SWF 打 O8–O12 得 `d3abd139…`，重放幂等。栈模拟 max_stack 7（header 9）。
- 真机：待测。

## 修订 r2（1017）

条件加上「可超限」（`get_maxOverLimitStep() > 4`）：不能超限的 ★5（如普通瓦格纳 111001/111069/111093）突破满 4 次后不再出现悖论之核格、不改文案、不动按钮状态。测试服 123123 号上看到「两格但按钮灰」的就是这类角色，按钮灰本身是正确的（已达上限）。after sha 已更新。O8–O12 打 v33 SWF 得 e30172b369db214bb681d135a7a6fc0442ab483c75be9c5225989e231419b4b2。
- r2 真机（1017，签名测试包 cad40d88…，本地服）：超限瓦格纳 111183 突破4 文案「确定要消耗1个超限结晶＋悖论之核吗？」；普通瓦格纳 111001 突破4 只有一格、按钮灰；玛丽娜突破2 文案仍为「确定要消耗1个★5破星结晶吗？」。截图 test-o12-text.png / test-r2-nonoverlimit.png / test-r2-normal-text.png。
