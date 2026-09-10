# 夏日白技能与准备语音路由

能力标识：`summer-bai-voice-router-v1`。

夏日白 `149990 / white_tiger_summer` 在常态随机播放 `skill_0/1`，在 Fever 随机播放
`matched_skill_0/1`。技能准备语音按状态分别轮换两条，每场战斗的每个 HUD 各自从第一条开始：

| 状态 | 第一条 | 第二条 |
|---|---|---|
| 常态 | `battle/skill_ready` | `battle/skill_ready_alt_1` |
| Fever | `battle/matched_skill_ready` | `battle/matched_skill_ready_alt_1` |

原客户端的 matched 分支由技能玩法切换条件控制，并不等同于 Fever。本补丁仅在声音选择时读取
`ZoneManager.isFeverMode()`，不改 `ChangeSkillFlag`、技能树或技能执行选中的 DSL。
其它角色仍走原有语音规则；已存在的赛瑞斯双形态语音分支保留全部原指令。

## 修改边界

只拼接三个方法体，不进行整类 AS3 回编：

- `SquadManagerImpl.invokeActionSkill`：仅替换夏日白本次播放的候选音频数组。
- `HudMemberStatus.update`：仅覆盖夏日白的语音状态选择，新增两个默认值为 0 的 int 槽，
  记录常态和 Fever 各自下一条准备音。槽值只在 0/1 间切换。
- `BattleCharacterLogic.resolveFollowingPathCollection`：在原有主角色、音效、准备音允许分支内，
  为夏日白预加载两条 alt 文件。两个原生 ready 和四个技能文件仍由原代码预加载。

第二条准备音不存在时退回该状态的第一条；第一条也不存在时沿原生 `Option.None` 保持静音。
不改变准备提示动画、准备完成判定、技能随机源、角色受伤或胜利语音。

本轮另六套新录语音各为两条技能、一条准备音，没有新增 matched 槽，不需要该补丁。

## 锁定基座与构建

输入仅接受已核实的 V14 SWF：

`dee19b6a96d8cece93021c09f937fdf35832ed362dcbf9b9df0b8750a3774572`。

方法按名称定位，再核对各自原始 code SHA；拒绝重复应用、未知基座、已有输出路径。
当前补丁产物 SHA：`05f9f72c7dbe1d90d0405457cf2cd59e4e579311ae2ca6f3466b04ff8e4b3e19`。

```powershell
python -B -X utf8 client-patch/summer-bai-voice-router/patch.py BASE.swf FINAL.swf --report build.json
python -B -X utf8 client-patch/summer-bai-voice-router/verify.py BASE.swf FINAL.swf build.json verify.json
```

所有参数用实际路径替换，输出放仓库忽略的工作目录。构建器只写指定的 SWF 和报告，
不访问设备、APK、角色包或资源 store。

## 验证

验证器使用另一份 ABC 解析器检查常量池、类、方法与非 ABC 的 SWF 字节：

- 主 ABC 92,556 个方法体中，仅 58,960、59,924、92,290 发生变化；其余 92,553 个不变。
- 只有 HUD 的实例 trait 末尾新增两个 int 槽；原槽、方法签名、类初始化器、脚本和元数据不变。
- 旧常量池逐项保留，新条目只追加。原方法注入块可被摘除，逐字节还原到原始 code。
- 栈深、作用域深及所有分支连接点检查通过，三个方法的 maxstack/localcount 无需增加。
- 在实际生成的注入字节上执行 20 项矩阵：技能 Fever/玩法条件交叉、其它角色不受影响、
  准备音跨状态独立轮换、缺失准备音兜底和选择性预加载。
- FFDec 24.0.1 可独立反编译三个改动类，读回与预期语音逻辑一致。

这些是静态及受控语义验证。安装后仍须在游戏内验收：常态与 Fever 各两种技能音可达、
两组准备音各自轮换、不会播放另一状态的台词、切换/合击/重试场景无音频缺失错误。

## 打包与保存用户数据

2026-09-10 只读核验的 MuMu 1 当前 base.apk 与本地 V14 完全同 hash：
`b2f549b25d4ee65c2ce4d3d4b61c3a2494a262f74c5c9f1f2367f1c729ab29dc`。
AIR 缓存中的 SWF 也精确等于上述输入 hash。

沿既有打包链只替换 `assets/worldflipper_android_release.swf`，重新 zipalign 并签名。
证书必须继续为 `729507c10a893879b14f46cf81d8e5052d4b66c2c081fa5b9f915a142a827a0b`；
所有其它非签名 ZIP payload 必须逐项不变，v1/v2/v3 签名均通过。
签名凭据只从既有构建环境读取，不写日志或仓库。

安装方必须重新核对目标设备与证书后使用保数据更新 `install -r`，禁止卸载或清数据。
若实际签名改变，只能找回对应私钥重签，不能靠强制覆盖解决。
AIR 运行缓存可能仍是旧 SWF；应按既有安装流程仅刷新已明确定位的应用运行缓存并核对
重新提取的 SWF hash，不触碰 Local Store、账号、资产账本或存档。
