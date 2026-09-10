# 杰拉尔四条技能准备语音

在已安装 V15 上，为 `129992 / unicorn_lancer_rose` 添加四条准备语音轮换。普通分支和原生 `matched` 分支共用一个轮换池，不改变水共鸣、Fever 或技能条件。原生四条 `skill_0..3` 随机选择保持原样。

按每个 HUD 实例独立轮换：

1. `character/unicorn_lancer_rose/voice/battle/skill_ready`
2. `character/unicorn_lancer_rose/voice/battle/skill_ready_alt_1`
3. `character/unicorn_lancer_rose/voice/battle/skill_ready_alt_2`
4. `character/unicorn_lancer_rose/voice/battle/skill_ready_alt_3`

`HudMemberStatus.update` 新增一个 `int` 槽 `geraldReadyNext`，在原生最终播放分支前选择路径。缺少某条备用音时回退基础音；基础音不存在则保留原生选择和计数器。夏日白的两个计数器及既有指令全部保留。

`BattleCharacterLogic.resolveFollowingPathCollection` 只为角色 129992 预载存在的三条备用音；原生主位、音效和准备语音开关条件不变。

## 构建与验证

源 SWF 必须为已验收 V15，SHA-256：
`eed904417bb6a2865a471d309ae60b3d64be1e51c8e7c28e9a5035a2d8b774b8`。

```powershell
python -B -X utf8 client-patch/gerald-ready-voice-router/patch.py <V15.swf> <new-V16.swf> --report <build.json>
python -B -X utf8 client-patch/gerald-ready-voice-router/verify.py <V15.swf> <new-V16.swf> <build.json> <verification.json>
```

输出必须为新路径。补丁校验源文件和两个方法的完整哈希，拒绝重复应用。仅窄插入两个方法并追加一个 HUD 槽及常量，不进行整类重编译。

验证器使用第二套 ABC 解析器，检查原常量前缀、类与方法结构、原始指令可还原、非 ABC 字节不变；执行实际输出指令的 549 个组合案例，覆盖文件缺失、四个计数位置、原生 Some/None、matched/Fever 状态、角色间隔离及预载。另检查原生技能随机和晒伤减抗方法字节不变。

这些结果证明静态结构与分支语义；APK 签名、设备安装、战斗播放需由交付执行者分别验收。此模块不写游戏资源、服务、设备或 APK，媒体资源必须独立交付。
