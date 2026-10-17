# 编队刷新重复能力汇总

`PartyTranslator.translate` 每次同步创建相同的三名出战角色列表，先按 HP=100%、普通阈值模式汇总开场技能槽，再按面板设置汇总攻击/伤害数值。面板设置经过原 AVM2 转换后也为 HP=100%、普通模式时，两次汇总的所有输入相同。

补丁只在这一条件下将首次结果赋给第二份局部结果，省去第二次角色列表拷贝及一次完整汇总。其他 HP 或全部能力模式保留原来的第二次计算。判断读取已经生成的 `hpForThreshold.params[0]` 和整数模式，再与同一 `Decimal_Impl_.fromFloat(1)` 比较；不重新解释原始配置，不新增跨次、全局或角色状态缓存。

## 方法边界与共享结果

仅在当前 `pinball.scene.character.translator::PartyTranslator/translate|1` 插入 16 条指令，当前方法体编号为 66996；以 label、方法载荷 SHA-256、局部变量及调用结构定位，不按历史编号选择。方法载荷指纹为 `bab1bb17179ebac5c563c3a50d781b7d61aa034066c5e394ab6c5a6df28ee33d`。完整类不重编译，也不修改常量池、trait 或签名。

这两份局部数组仅传给 `createStatus` 的数值读取和当前 leader PF 数值计算。面板返回计算后的数值与 Option；不暴露汇总数组。`AbilityContentSummary` 的 `changeContents` 仅在构造器赋值，getter 遍历原数组并在需要时另建局部数组；`AbilityTotalizedSummary` 读取这些 getter、只写自身字段，未对源数组排序、过滤或标记。`getBattleAbilities` 返回新收集数组，汇总的 debug 追加不会写回角色原能力容器。`BattleAbilitySource.add` 只构建本次汇总的 source 内容，不注册战斗回调。描述/条件读取可能初始化现有 getter 缓存，第一次调用已完成这些初始化；没有必须执行两次的注册或计数副作用。

`reader-fingerprints.json` 锁定当前汇总实现、汇总读者及关键列表生成方法。输入来自同批另一项方法修复时，允许其他方法已经变化；目标与这些读者变化则拒绝。序列化后逐 tag 回读，并证明所有其他方法、池、类布局与当前输入一致，因此保留既有及同批已组合的补丁。

## 使用

```powershell
python client-patch/party-refresh-performance/patch_swf.py <输入.swf> <新输出.swf>
python client-patch/party-refresh-performance/tests/test_patch.py <已验内网输入.swf> <临时目录>
python client-patch/party-refresh-performance/tests/run_tests.py <已验内网输入.swf> <AIR测试目录>
```

patch 不改写输入或已有输出；输出旁保存同名 JSON 不变性报告。已有 APK、SWF、CDN、配置、设备和登记不由本工具改写。

## 验证及限制

实际抽取当前方法的配置转换与两次汇总 AVM2 片段，分别运行原始 138 条与优化后 154 条指令。控制路径没有根据源码仿写；桌面 AIR 执行片段，确定性能力源 spy 检查输入和输出。矩阵包含不同主/副位与空槽、装备、魂、EX、级别、觉醒、HP 阈值，以及 Boolean/数值/字符串/undefined/null/NaN/无穷/溢出输入。

本批 1,536 场景、9,217 断言通过，300 个符合条件场景汇总调用由 2 次降为 1 次，其他场景仍为 2 次；输出 JSON 和来源槽位一致。采用显式编译选项后的桌面夹具 10,000 次调用计时为原始 127 ms、优化 72 ms，属于该次夹具观测，不是 Android 游戏收益。测试源 spy 不替代完整游戏能力/资源解析；设备实战、帧率与偶发卡死改善均未验证。

AIR SDK 51.2.1.5 测试编译显式使用 `-compiler.float=false`，直接生成既有解析工具支持的 ABC 46；不手动降版或删除池。测试代码、夹具和运行工具不会进入 APK。

无持久化字段、角色 ID、账号归属或存档格式变化；无需存档导入/导出迁移。
