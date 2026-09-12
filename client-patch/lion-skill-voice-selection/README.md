# 狮子已选语音池（当前 V16-plus 的两方法增量）

仅针对 119996 / `lion_swordman_reborn`，保留作者选定的首次重录前原音与最新录音。

- 技能发动：原生 `CharacterShortVoiceLogic.get_skillVoicePaths` 先照常按存在文件连续枚举，返回前仅对狮子执行 `splice(2,2)`。当前七个文件得到 `skill_0/1/4/5/6`，中间不满意的 `2/3` 留在资源里但不进入播放池；其他角色原列表保持。原生遇到文件缺号就停止的规则保持，不制造缺失路径。
- 准备音界面：`CharacterVoiceLogic.createVoicePathMap` 原准备数组建好后，仅对狮子列出 `skill_ready`、`skill_ready_alt_1`、`matched_skill_ready_alt_1`。每个路径均检查存在；旧普通准备缺失时可用同音 `matched_skill_ready` 别名代替。正常情况下不重复展示该旧音别名。
- 战斗准备：当前已有的狮子普通/强化两池各在旧音与对应最新 alt 之间交替，其 HUD、预载方法与计数槽全部原样保留。语音资源修订需把两个 base 文件都设为同一条旧音，两个 alt 保持最新音；本补丁不写音频。

输入严格锁定当前 SWF SHA256 `2a514ff300dc2be2ef09a3d08aa0d2ae28e2ec2189aa44c6212dd40084a0ad42`，目标方法另验 code hash。使用仓内 ABC 汇编器，只插入 8 + 40 条指令；技能 getter 的 maxstack 从 2 增为 4，其余方法头不变。常量全部复用，无新增字符串、属性、类或槽。已有九尾、夏日白、杰拉尔、狮子准备音等代码保持，不经过旧版希尔媞损伤补丁。

```powershell
python -B -X utf8 client-patch/lion-skill-voice-selection/patch.py SOURCE.swf FINAL.swf --report OUTPUT/build-report.json
python -B -X utf8 client-patch/lion-skill-voice-selection/verify.py SOURCE.swf FINAL.swf OUTPUT/build-report.json OUTPUT/verification.json
python -B -X utf8 -m unittest discover -s client-patch/lion-skill-voice-selection/tests -v
```

输出路径必须全新。构建输出逐指令 P-code 前后表与方法 diff；每条指令保留实际常量池索引并注释解析名。验证器用独立 ABC 解析器检查只有这两个方法发生变化，提供其余 92,554 个方法的原始 code SHA256 清单，移除插入块后必须恢复原 code。它执行最终 SWF 中实际提取的指令，覆盖技能池 640 种、准备 UI 80 种角色及文件缺失组合。五项专项测试另验证错误角色/删除范围变异会被拦截。

本目录只生成和验证 SWF，不安装设备、不发布数据、不保存凭据。APK 的离线打包由任务交付脚本复用已审查的同签工具完成；需核对证书与所有非 SWF 载荷的 hash。静态检查不代表游戏内试听或设备安装已通过。
