# 狮子准备语音轮换（V16 增量）

只针对 119996 / `lion_swordman_reborn`。原生 `HudMemberStatus.update` 已按技能强化条件选择普通或 matched 准备音，补丁在该选择之后执行；两种原音各自与一条备用音交替。按实际选中的原音路径识别两个池，不修改强化判定、Fever 状态或技能行为。每个 HUD 有两个独立的 0/1 计数槽。

普通池为 `battle/skill_ready` 与 `battle/skill_ready_alt_1`；匹配池为 `battle/matched_skill_ready` 与 `battle/matched_skill_ready_alt_1`。全路径前缀均为 `character/lion_swordman_reborn/voice/`。备用不存在时保留本次原音；原生返回 None 或其它路径时完全保留原结果。只在原生主位、音效许可、准备音许可预载分支加载两条新增文件。

输入仅接受已安装 V16 的 SWF SHA-256 `1ce423019de2604171d0e6824f9f629e81efd6689d43503322b96e981eca398a`。在原 V16 夏日白与杰拉尔代码之后新增两个小区块：HUD 的第 254 条指令前、角色预载的第 162 条指令前，分支采用 enter 策略。已有 92,554 个其它方法体、旧常量池、原有槽、原方法指令、SWF 其它标签原样保留。输出必须为新文件；拒绝重复应用。

`patch.py` 生成 SWF 与构建报告；`verify.py` 使用独立 ABC 解析器验证结构差分，并执行产物中实际插入的 90 条 AVM2 指令，覆盖 150 种分支/状态/缺文件/其它角色情况。`tests/test_router.py` 另有共享计数器与错误预载角色的反向变异检查。

本目录不含 APK、音频、私钥或设备操作。打包由离线交付脚本使用匹配 V16 的证书完成；不改变 Android 包名、版本码或原有有效载荷。源码与离线检查通过不代表已安装或游戏内试听通过。
