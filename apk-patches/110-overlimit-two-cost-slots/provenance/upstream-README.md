# 104 超限突破窗口显示两格（超限结晶 + 悖论之核）（O10/O11）

超限每步同时扣 1 个超限结晶和 1 个悖论之核，突破窗口的道具栏从 1 格（只有超限结晶，占原 ★5 突破石的位置）改成 2 格，各显示持有数，0 个灰掉；点悖论之核格打开道具详情。

- 首发 APK 版本：**v34**（叠在 v33 上）。作者 1017 要求。
- 改动位置：`OverLimitWindow/run`（按钮注册）、`OverLimitWindow/getStatusInformation`（道具栏显示数据），主 ABC `boot_ffc6`。
- 做法：两个方法里 `targetCharacter.getAwakingCrystalToOverLimit()` 取回的数组（每次新建）之后，目标角色 ★5 且 `overLimitStep ≥ 4` 时 `push(10000302)`。原生 `OverLimitWindowView.setupStatusInformationWindow` 本就支持 1/2 格两种布局（★4 及以下就是 2 格），按钮 id `33554432+itemId` 走原生「道具详情」分支。突破可否、扣几个仍由 101/103 和服务端决定，本条只改显示。
- 10000302 用 `10000*1000+302` 运行时算；`push` 多名取自 `OwnedOverLimitLogic/getOverLimitState`；不追加常量池。
- 依赖：O3（超限模式只列超限结晶）、101、103。不碰 `PartyCarousel/update`。

## 方法体

| 方法 | header | before | after |
|---|---|---|---|
| OverLimitWindow/run | [11, 12, 1, 2] 不变 | `2787a647de463c9493d6347076db09a4b4417434174a9394f4e77c7352fbc14a` | `b96160fc0f1046a50cf78065ed8d907861a2a65fb13c4f365abad60cbd4b2a7e` |
| OverLimitWindow/getStatusInformation | [10, 7, 1, 2] 不变 | `5a3d0744321eb787d738b56df42059611df979f493b0c121fdc239ce491ad83d` | `c64d19bbf7957fd9490406d4d251abb9d1e16eeb3062e1b49148f56afbd29aa4` |

P-code 见 [pcode/](pcode/)。

## 脚本

同 102/103：[v34_patches.py](source/v34_patches.py)、[apply.py](source/apply.py)（`python apply.py IN.swf OUT.swf O10 O11` 只打本条）。

## 自测

- 静态：v33 SWF（`3b7b3391…aaa4`）打 O8–O11 得 `28b6c9cd…55be`，重放幂等。
- 真机：1017 MuMu-1 + 本地服（localsrv219），本地 v33+O8–O11 测试包 e7382ac5…：通过。截图见 ../../v34-overlimit-device-test.png。

## 修订 r2（1017）

条件加上「可超限」（`get_maxOverLimitStep() > 4`）：不能超限的 ★5（如普通瓦格纳 111001/111069/111093）突破满 4 次后不再出现悖论之核格、不改文案、不动按钮状态。测试服 123123 号上看到「两格但按钮灰」的就是这类角色，按钮灰本身是正确的（已达上限）。after sha 已更新。O8–O12 打 v33 SWF 得 e30172b369db214bb681d135a7a6fc0442ab483c75be9c5225989e231419b4b2。
- r2 真机（1017，签名测试包 cad40d88…，本地服）：超限瓦格纳 111183 突破4 文案「确定要消耗1个超限结晶＋悖论之核吗？」；普通瓦格纳 111001 突破4 只有一格、按钮灰；玛丽娜突破2 文案仍为「确定要消耗1个★5破星结晶吗？」。截图 test-o12-text.png / test-r2-nonoverlimit.png / test-r2-normal-text.png。
