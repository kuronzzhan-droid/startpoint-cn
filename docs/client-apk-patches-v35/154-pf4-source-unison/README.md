# 154 PF Lv4 来源通用化与码 36 合击 Lv4 联动（v35pf4）

- 首发版本：v35pf4 / 1008020（run19pf4）
- capability：`pf-lv4-source-v2`
- 依赖前置补丁：118（`pf-lv4-data-v1`）、144（`pf-unison-chain-v1` 码 36 合击 PF 链）、147（基于 v35o SWF 叠加）
- 对应数据边：赛瑞斯（`129999`）与水属性杰拉德（`129989`）数据边（`rel-1.4.273`，`custom_ability_string` 中 `wfx_pf4_<角色id>` 与 `override_seris_dragon_lv4`）

## 作用

将 PF Lv4 的解锁资格、连击门槛与弹板染色配置从「只看当前队长角色 ID」通用化为「按实际选中的有效 Lv4 PowerFlipOverride 来源角色解析」，并打通码 36 合击强化弹射链的 Lv4 选择：
1. 当主位（如水杰拉德，仅有 Lv1–3 专属覆盖）搭配拥有有效 Lv4 覆盖的合击角色（如真龙状态赛瑞斯 `forLevels=[4]`）且持有有效码 36 时，达到连击门槛后主位执行自身 Lv3 专属 PF，合击链自动选中并执行合击角色的 Lv4 覆盖（物理第三槽）；
2. 配置键优先读取解锁来源角色的 `wfx_pf4_<sourceCharacterId>`，缺失时回退至实际队长角色的 `wfx_pf4_<leaderCharacterId>`，再缺失则回退至默认 `100:FF4040`；
3. 弹板每 10 帧刷新一次有效 Lv4 覆盖来源与门槛/颜色缓存，`BattleFlipperView/draw` 直接读取缓存，避免每帧渲染重复调用 checker。

## 改动类与方法

- 修改 4 个原方法：`MemberImpl/startPowerFlip`、`MemberImpl/wfxPfChainExecute`、`BattleFlipperImpl/update`、`BattleFlipperView/draw`。
- 新增 9 个辅助方法与 2 个静态槽：`BattleAbilityTotalizerImpl/wfxPf4SelectRow`、`MemberImpl/wfxPf4Action`、`MemberImpl/wfxPf4ChainId`、`MemberImpl/wfxPf4MainId`、`MemberImpl/wfxPf4Prepare`、`Battle$/wfxPf4SourceId`、`Battle$/wfxPf4SourceConfig`、`Battle$/wfxPf4Display`、`Battle$/wfxPf4DisplayCached`。

## 开关与数据写法

- `custom_ability_string` 可选配置键：`wfx_pf4_<角色id> = "<combo门槛>:<6位HEX颜色>"`（缺省 `100:FF4040`）。
- 码 36 的 `arg & 1 == 1`（强制类型 PF）开启时，合击专属覆盖不参与 Lv4 解锁或选树。

## 最终 P-code

- [Battle_static/wfxPf4Display](pcode/Battle_static__wfxPf4Display.pcode.txt)；文件 SHA256 `b6b912764b37d327b561eec5f4119390b417378f88d5f15bfa8e32030c8bc58c`（`Battle$/wfxPf4Display header=[3, 4, 1, 2] sha=2caffc39a875ed18e36ff0ec0b029ef414e775bba56a9c315671e33dbc4dc0e0`）。
- [Battle_static/wfxPf4DisplayCached](pcode/Battle_static__wfxPf4DisplayCached.pcode.txt)；文件 SHA256 `507bdd76d6b3ca642bb9b6f5de1f20a1f84f18711bf28790b89884d561406a05`（`Battle$/wfxPf4DisplayCached header=[2, 4, 1, 2] sha=7728021d919e38e15b87285ea67a0d11ba827c85dc04d6869b5468044fea538d`）。
- [Battle_static/wfxPf4SourceConfig](pcode/Battle_static__wfxPf4SourceConfig.pcode.txt)；文件 SHA256 `93a39595a5f08e5959c3c8303c786ec04136965ed09a55fae2e3ed5348b7c96b`（`Battle$/wfxPf4SourceConfig header=[4, 10, 1, 2] sha=463f48cb14cfd85c8c723612c7e331e0986aed4ce11d7a6cd7a4e146a727e989`）。
- [Battle_static/wfxPf4SourceId](pcode/Battle_static__wfxPf4SourceId.pcode.txt)；文件 SHA256 `05300117aa83bee39e6e636d3c7c5f8c01001cbb27b5b08fe386d72610d37a9c`（`Battle$/wfxPf4SourceId header=[2, 6, 1, 2] sha=385474e2fdb20314edc3f6e1573e78debf90aa2f6e255845c576b4652709f446`）。
- [BattleAbilityTotalizerImpl/wfxPf4SelectRow](pcode/BattleAbilityTotalizerImpl__wfxPf4SelectRow.pcode.txt)；文件 SHA256 `33b8fd575df153b068fe7b8d7b1c0aad40d0013aaf8a1f2a0c5d4444efddeb8c`（`BattleAbilityTotalizerImpl/wfxPf4SelectRow header=[3, 9, 1, 2] sha=24f8537fcace6168a3989b86a458f19ac60a6edede6c99c1324e723feb219faf`）。
- [BattleFlipperImpl/update](pcode/BattleFlipperImpl__update.pcode.txt)；文件 SHA256 `879b37652152a60ed4bf4d6bbe1ace664affd8decbf0919e5c9f665d09c5458c`（`BattleFlipperImpl/update header=[5, 10, 1, 2] sha=c493b0416f6a937a66492ed1be8bf3cc3b978e53805e0f8bc507752169b53e7a`）。
- [BattleFlipperView/draw](pcode/BattleFlipperView__draw.pcode.txt)；文件 SHA256 `92530d98b36deb7a0cd71ddf10b3c638b8ffac2d71fa3467704a85a54bd5556e`（`BattleFlipperView/draw header=[6, 27, 1, 2] sha=f1eca1f029170909d6e57d2eb9bb3e81dd31f32f689d3d1bd51dddbdb2917bd4`）。
- [MemberImpl/startPowerFlip](pcode/MemberImpl__startPowerFlip.pcode.txt)；文件 SHA256 `4dfebaf7fee2596ff283814c02e6072fbfb87bed6602504890af014aea63cedc`（`MemberImpl/startPowerFlip header=[27, 22, 1, 2] sha=978ec3665d6722397336fc57915c109e6a5baa42cba376c233ceb4ea6eb482ab`）。
- [MemberImpl/wfxPf4Action](pcode/MemberImpl__wfxPf4Action.pcode.txt)；文件 SHA256 `5d750b9b32d095a7eca0e2a625a62900244b505a82063e3ce55e57a92a83d7df`（`MemberImpl/wfxPf4Action header=[2, 3, 1, 2] sha=ed0ed2f7279b9bd830b5b481f85f209954564b9d46bd2b56d32e1ccbaa85da5e`）。
- [MemberImpl/wfxPf4ChainId](pcode/MemberImpl__wfxPf4ChainId.pcode.txt)；文件 SHA256 `e1750e6fe15ae3728e4b918ac1dd883d4068bb40d274d19699232825a07e9ec6`（`MemberImpl/wfxPf4ChainId header=[3, 5, 1, 2] sha=fff62c8df43ea83986b2abcf096c583168447f92143eb912435bd7a527b24045`）。
- [MemberImpl/wfxPf4ReadyState](pcode/MemberImpl__wfxPf4ReadyState.pcode.txt)；文件 SHA256 `74ae04255b651e3ffde08cd6cfeaf77fc9fbe04a6c2e7ac2f0d9459cea081934`（`MemberImpl/wfxPf4ReadyState header=[3, 4, 1, 2] sha=6279333c60bb276063927b29813ac68363506e3681f9a1611d19a2cf793ae65a`）。
- [MemberImpl/wfxPf4State](pcode/MemberImpl__wfxPf4State.pcode.txt)；文件 SHA256 `e9082622c499d691091a6f683480778359c09c7b1e3e0c5a60e034df647c01ee`（`MemberImpl/wfxPf4State header=[5, 7, 1, 2] sha=4a4dd10e4a1a4e249286de0b018ed8f772278d54d83709418916c6b49cbb3a14`）。
- [MemberImpl/wfxPfChainExecute](pcode/MemberImpl__wfxPfChainExecute.pcode.txt)；文件 SHA256 `23c44dd6bdc8115a37e4b7089efa51d49803a7ca9f94f2a2a3ab8e1d5fe76a62`（`MemberImpl/wfxPfChainExecute header=[28, 11, 1, 2] sha=bfad5019390105ab8c9df397ec00ff30052aaa234a8dd53a5fe2f3f2d8e81e34`）。

## 补丁源与构建脚本

`source/` 保存本补丁的指令构造与构建脚本快照：

- [bootstrap.py](source/bootstrap.py) ← `bootstrap.py`；SHA256 `9fd923adb19f99481ffdac48ab1e09542fd69958e1816486e064bf1d0c63cca9`。
- [build.py](source/build.py) ← `build.py`；SHA256 `686f26c3e19976eab8d400098afc3ed3b6fa21418786ca83d0dd4f23504672a0`。
- [delivery_replay.py](source/delivery_replay.py) ← `delivery_replay.py`；SHA256 `46f420e719bcd966a5f9924790a838c0c3314a5c00e1eee43058faa7ddb8de77`。
- [evidence.py](source/evidence.py) ← `evidence.py`；SHA256 `86e7f555da3a156724e6009085aac34ca193d64015d2f65c2124689b7c027c14`。
- [framework.py](source/framework.py) ← `framework.py`；SHA256 `0ca0f2b6a5976c943cc962516be8cb542b98e78fc9a0ab66a410b850e3eccdea`。
- [src/__init__.py](source/src/__init__.py) ← `src/__init__.py`；SHA256 `9878c722a21b1abeda9a3c7208239d8e8c2e0a336997cb3e875209cc12f22941`。
- [src/patch.py](source/src/patch.py) ← `src/patch.py`；SHA256 `bbbed16071a88338841dec96ceaf64c322afffba430fc7eb2b40d4a0fd00df7b`。
- [src/selectors.py](source/src/selectors.py) ← `src/selectors.py`；SHA256 `d821a0b0fc94570049ac8a7b2514ba7179bd5e236dac63ae63cf05b01ae633a7`。
- [src/sources.py](source/src/sources.py) ← `src/sources.py`；SHA256 `339298f57bdb3c7ff1c7803c52abd5e94a8a6a4443be611ca4fa677dcd87eab8`。
- [static_check.py](source/static_check.py) ← `static_check.py`；SHA256 `1b340c53257aec396ba7f41e6ff3d57c62f1fb06401595d9b427b91f157f9376`。

## 已知限制与验收边界

- 单写 `wfx_pf4_<id>` 文本键不会凭空解锁 Lv4，仍须角色能力实际注册了含等级 4 的 `PowerFlipOverride` 且满足其原生 `during` checker（如赛瑞斯真龙状态 Unique 22）。
- 测试服输出 SWF SHA256 `a14c4e47da67fd41e4a05f852d6fd43bcf0ef4fcecd431b625ee6880ad0b29e9`。

来源工作区：`<WORKDIR>/v35-generic-20261018/run19pf4`、`<WORKDIR>/outputs/apk/general-pf4-20261022`（任务书 `<WORKDIR>/v35-generic-20261018/TASK19PF4.md`）
