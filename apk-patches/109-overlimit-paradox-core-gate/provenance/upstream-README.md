# 103 缺悖论之核时超限按钮灰掉（O9）

超限模式下悖论之核为 0 时，突破窗口按「道具不足」处理：按钮灰掉，点按只出提示，不再打开会被服务端拒绝的确认对话框。

- 首发 APK 版本：**v34**（叠在 v33 上）。
- 改动位置：`OverLimitWindow/getOverLimitState`（主 ABC `boot_ffc6`）。
- 修的问题（清点报告 `D:\WF\bughunt-20261015\REPORT.md` 第 4 条）：101（O5）在悖论之核为 0 时把可突破次数算成 0，但窗口状态只看超限结晶，仍判可突破；`ExpodOverLimitByItemDialog` 用 `Slider(1, max(1, n))` 把 0 抬成 1，确认后发 `character/over_limit` count=1，服务端因缺悖论之核拒绝，玩家看到报错。
- 做法：取完突破道具列表（category 2）之后插入：目标角色 ★5 且 `overLimitStep ≥ 4`，且 `player.getItemNumber(10000302) == 0` 时，把传给 `targetCharacter.getOverLimitState` 的列表换成空数组。原生逻辑随即返回 `Impossible([InsufficientEitherStackOrItem])`（超限模式下 O4 已关掉用重复角色突破），`canOverLimit()` 为 false，`characterOverLimit` 走提示分支。窗口、对话框入口全部经过这个方法。
- 10000302 用 `10000*1000+302` 运行时算，与 101 相同，不追加 int 常量。
- 依赖：101（O5）与 O4（84）。与服务端 `assets/character_overlimit.json` 的 `extra_costs`（每步扣 1 个 10000302）一致；若以后改成「零核」（超限不再消耗悖论之核），本补丁和 101 要一起撤。
- 不碰 `PartyCarousel/update`。

## 方法体

| | header | code SHA-256 |
|---|---|---|
| v33 原（before） | [2, 3, 1, 2] | `d39a4847f5adfd05c660a4bacd1ea2bad9b13bdabe8b72a72927fa9bbca7bc9b` |
| 打后（after） | [4, 3, 1, 2] | `ae683cc1f5574ac7b415c43cf779ea642535cd6a66531aa1ee51a150d1492068` |

P-code：[before](pcode/boot_ffc6--OverLimitWindow_getOverLimitState.before.pcode.txt) / [after](pcode/boot_ffc6--OverLimitWindow_getOverLimitState.pcode.txt)。

## 脚本

同 102：[v34_patches.py](source/v34_patches.py)、[apply.py](source/apply.py)（`python apply.py IN.swf OUT.swf O9` 只打本条）、[run.py](source/run.py)。

## 自测

- 静态：同 102（两条一起打、重放幂等）。栈模拟 max_stack 3。
- 真机：1017 MuMu-1 + 本地服（localsrv219），本地 v33+O8–O11 测试包 e7382ac5…：通过。截图见 ../../v34-overlimit-device-test.png。

## 修订 r2（1017）

条件加上「可超限」（`get_maxOverLimitStep() > 4`）：不能超限的 ★5（如普通瓦格纳 111001/111069/111093）突破满 4 次后不再出现悖论之核格、不改文案、不动按钮状态。测试服 123123 号上看到「两格但按钮灰」的就是这类角色，按钮灰本身是正确的（已达上限）。after sha 已更新。O8–O12 打 v33 SWF 得 e30172b369db214bb681d135a7a6fc0442ab483c75be9c5225989e231419b4b2。
- r2 真机（1017，签名测试包 cad40d88…，本地服）：超限瓦格纳 111183 突破4 文案「确定要消耗1个超限结晶＋悖论之核吗？」；普通瓦格纳 111001 突破4 只有一格、按钮灰；玛丽娜突破2 文案仍为「确定要消耗1个★5破星结晶吗？」。截图 test-o12-text.png / test-r2-nonoverlimit.png / test-r2-normal-text.png。
