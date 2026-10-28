# 145 服务器确认协力胜利（客户端端）

- 首发版本：v35m / 1008012（run13）
- capability：`coop-server-confirmed-clear-v1`
- 依赖前置补丁：144（基于 v35l SWF 叠加）
- 对应数据边：无客户端数据表变更；依赖服务端在首个成员完成 `/multi_battle_quest/finish` 胜利结算后向同房其余活跃连接广播 `BattleServer2Client.Message(Finalized)`（`[1,[2]]`）

## 作用

在协力 Socket 联机战斗中，当队友先一步通关并经服务器确认胜利后，尚未打完的客户端收到服务器下发的 `Finalized`（`[1,[2]]`）消息时，在满足安全门禁（协力 Socket 模式、非单人/练习/Raid/BothBoss、未孤立/未恢复、当前处于 Playing 且位于最后一层最后一个 Usual 状态的 Zone）的前提下，立即将本机战斗切入原生 `QuestClear` 通关状态，跳过等待其余镜像副本完成，并抑制后续因 Socket 关闭触发的通信中断弹窗。

## 改动类与方法

- `BattleScenePlayingStateImpl/socketInput_serverMessage`：在 `BattleServerMessage.Finalized`（index 2）分支插入 `wfxAcceptServerClear()` 调用。
- `BattleScenePlayingStateImpl/isOtherBattleFinished`：入口检查本场战斗是否已标记服务器确认通关，若为真直接返回 `true`，免除等待镜像副本或 900 帧超时。
- `BattleScene/socketErrorDialog`、`BattleScene/isolateAsForceAbort`：入口调用 `wfxServerClearActive()`，若已接受服务器确认通关则直接返回，抑制 `S1000` 等断连报错。
- 新增辅助方法：`BattleScenePlayingStateImpl/wfxAcceptServerClear`、`BattleScene/wfxMarkServerClear`、`BattleScene/wfxServerClearActive`，以及静态弱键表 `BattleScene.wfxServerClearedBattles`。

## 开关与数据写法

- 无客户端数据表配置开关；由服务端下发的 S2C JSON `[1,[2]]` 消息触发，客户端按上述场景与阶段门禁自动判定。

## 最终 P-code

- [BattleScene/isolateAsForceAbort](pcode/BattleScene__isolateAsForceAbort.pcode.txt)；文件 SHA256 `9092bcdb4c11bf472433e39dd1322a4ce49c5c28ed76b58da6b2504bf264ca34`（`BattleScene/isolateAsForceAbort header=[3, 1, 1, 2] sha=4b7c50c87b2c61ddfc59cebae0afa6c877f88f04e6ce41855fd7b852980680e1`）。
- [BattleScene/socketErrorDialog](pcode/BattleScene__socketErrorDialog.pcode.txt)；文件 SHA256 `00aac7d30c61807afcb280faa681050aeb87095b3f7bd8f2e807d30979d8a7cb`（`BattleScene/socketErrorDialog header=[2, 2, 1, 2] sha=6e9cd519f0ecab51d49499db1216889631de1c4a9e686d98cc0c6245a1085337`）。
- [BattleScene/wfxMarkServerClear](pcode/BattleScene__wfxMarkServerClear.pcode.txt)；文件 SHA256 `86ed3514ca4a8db110d16076a009ecbb27c84b685f04c445406f341bdbdd8435`（`BattleScene/wfxMarkServerClear header=[3, 2, 1, 2] sha=d75e9bd1b4a4327852990660f9f96634016ac92a005ab467dd24e940a15ebaa8`）。
- [BattleScene/wfxServerClearActive](pcode/BattleScene__wfxServerClearActive.pcode.txt)；文件 SHA256 `7a847c350c12b6386349e05790ff1b046ff7ab6863ab98c947bde6dd5edb83c0`（`BattleScene/wfxServerClearActive header=[2, 3, 1, 2] sha=7890f25394625700b4ca1315367dceff4cc4bbde9a6137c095de6a7cddcaee3b`）。
- [BattleScenePlayingStateImpl/isOtherBattleFinished](pcode/BattleScenePlayingStateImpl__isOtherBattleFinished.pcode.txt)；文件 SHA256 `704141bc667a746d5f790a033030185a46c223650a8a2cacc243e1bdecd32141`（`BattleScenePlayingStateImpl/isOtherBattleFinished header=[5, 10, 1, 2] sha=3fd01e4d01fa60f186dc5ca300ccab36cb3933258fc3021f171f9e0bc0f06e23`）。
- [BattleScenePlayingStateImpl/socketInput_serverMessage](pcode/BattleScenePlayingStateImpl__socketInput_serverMessage.pcode.txt)；文件 SHA256 `4d060d3b9fb82aaf5bce3857d874806c867efedf828a93dd0ff6d65809413ac8`（`BattleScenePlayingStateImpl/socketInput_serverMessage header=[10, 2, 1, 2] sha=6d60c192ac372e39364892c050438cbf44841dc751e16914a6167feb0ab0dbfc`）。
- [BattleScenePlayingStateImpl/wfxAcceptServerClear](pcode/BattleScenePlayingStateImpl__wfxAcceptServerClear.pcode.txt)；文件 SHA256 `d7cd42d64228ceb366b5c6a35236dd27447efebd11b91aaae73a6d8c596c2584`（`BattleScenePlayingStateImpl/wfxAcceptServerClear header=[3, 5, 1, 2] sha=2ca69b04ce2b2774757fa67347355cb670751c2bd0d7c6a42d8db1da8edc7945`）。

## 补丁源与构建脚本

`source/` 保存本补丁的指令构造与构建脚本快照：

- [bootstrap.py](source/bootstrap.py) ← `bootstrap.py`；SHA256 `60781713290747e66a883cfe9fea610fb255113db03d92ab0274bc3043f69490`。
- [build.py](source/build.py) ← `build.py`；SHA256 `a8028d1d13940787a614169a9b98fd93055a652d6c9ab592b4813ea06ea42618`。
- [coop_patch.py](source/coop_patch.py) ← `coop_patch.py`；SHA256 `ac01efa219f22e6ee72a84f9547cde4b428008aab2e3d2995bc2f6af48cd7ffe`。
- [framework.py](source/framework.py) ← `framework.py`；SHA256 `0ca0f2b6a5976c943cc962516be8cb542b98e78fc9a0ab66a410b850e3eccdea`。
- [integrity.py](source/integrity.py) ← `integrity.py`；SHA256 `c18e19314293d9099885be5fe802f78477e59fe42b700edcfaa5552590bf269e`。
- [static_check.py](source/static_check.py) ← `static_check.py`；SHA256 `1b340c53257aec396ba7f41e6ff3d57c62f1fb06401595d9b427b91f157f9376`。
- [verify.py](source/verify.py) ← `verify.py`；SHA256 `7194d3693877a0c80d6a44ec684813d94b9bdd423baae0ce8dcc578997a9835d`。

## 已知限制与验收边界

- 若本机收到服务器确认通关时本地 Boss 尚未死亡，画面会直接进入原生通关演出（不等待本地 Boss HP 归零）；中间层、中间 Zone、BothBoss 或 Raid 模式不启用此提前通关路径。
- 测试服输出 SWF SHA256 `372c89f55b701d9e48e3ff2b84a45c6c61fb155ec210d8cf6fb1950f194b3899`。

来源工作区：`<WORKDIR>/v35-generic-20261018/run13`、`<WORKDIR>/outputs/apk/coop-confirmed-clear-20261021`（任务书 `<WORKDIR>/v35-generic-20261018/TASK13.md`）
