# 102 像素小人改用持有角色的台座（O8）

角色详情、玛纳盘、扭蛋结果等页面的像素小人，玩家持有该角色时按持有角色取台座，超限台座（_6/_7）在这些页面也显示。

- 首发 APK 版本：**v34**（叠在 v33 上）。
- 改动位置：`PixelArtCharacter/getPedestalImagePath`（主 ABC `boot_ffc6`）。
- 修的问题：v31 的 80/81（O6/O7）只在 `OwnedCharacterLogic` 上生效（方法里先判 `"overLimitStep" in this`）。`PixelArtCharacter` 通过 `globalLogic.getGeneralCharacter(id)` 拿到的是 `GeneralCharacterLogic`，没有突破次数，于是角色详情页永远是普通 ★5 台座；编队页拿的是持有角色，所以那里会变。无错误码。
- 做法：在取到 `GeneralCharacterLogic`（local3）之后、按全身/半身分支之前插入：`player` 非空且 `player.hasOwnedCharacter(id)` 时，`local3 = player.getOwnedCharacter(id)`。之后原有的 `getPedestalImagePath()` / `getHalfPedestalImagePath()` 虚调用落到已打 O6/O7 的方法。未持有、`player` 为空、`character` 为 None 时行为不变。
- 依赖：80、81（O6/O7）与 86（台座图集 _6/_7 帧）。没有它们时，本补丁只是把同一角色的通用台座换成持有角色的通用台座，结果相同。
- 只用主 ABC 已有常量池（`player`、`id`、`hasOwnedCharacter`、`getOwnedCharacter` 均为 public QName，唯一），不追加；localcount 4→5。
- 已知影响：联机房间、排行榜里别人的同一个角色，也按「我自己那只」的突破状态显示台座。
- 不碰 `PartyCarousel/update`。

## 方法体

| | header | code SHA-256 |
|---|---|---|
| v33 原（before） | [3, 4, 1, 2] | `7a286e705e1416d02a1d9dcbb811f80d238fe48976b8b1b0ab4cbb54888330ed` |
| 打后（after） | [3, 5, 1, 2] | `10eb1e21f915782bcd5715a3fb58670cb18737ae8a5f0f569781f774b1a48f0d` |

P-code：[before](pcode/boot_ffc6--PixelArtCharacter_getPedestalImagePath.before.pcode.txt) / [after](pcode/boot_ffc6--PixelArtCharacter_getPedestalImagePath.pcode.txt)。

## 脚本

- [v34_patches.py](source/v34_patches.py)：O8/O9 定义（`apply` 函数 + before/after sha），框架是 `D:\WF\perf-v30-20261015\tools\perf2_core.py`（原 sha→打、已打 sha→跳过、其他→整包拒绝；主 ABC 不追加常量池；改动只限这两个方法体，其余方法体逐字节核对）。
- [apply.py](source/apply.py)：`python apply.py IN.swf OUT.swf [--report r.json] [O8]`，可只选 O8。
- [run.py](source/run.py)：生成 before/after P-code 的辅助脚本。

## 自测

- 静态：对 v33 SWF（`3b7b3391…aaa4`）打 O8–O11 得 `28b6c9cd…55be`（只打 O8+O9 得 `c634149b…5ac8`）；再打一次全部 already_present，输出逐字节相同。栈/作用域模拟通过（max_stack 3）。
- 真机：1017 MuMu-1 + 本地服（localsrv219），本地 v33+O8–O11 测试包 e7382ac5…：通过。截图见 ../../v34-overlimit-device-test.png。
