# 编队与角色数据运算优化

只修改 11 个既有方法的 AVM2 body，增加唯一 DoABC `cn.optimize.data.DataOptimization`。不重编译既有游戏类，不改既有 trait、方法签名、资源、存档或服务配置。

## 方法范围

| 项目 | 既有方法 | 行为与失效边界 |
| --- | --- | --- |
| A | CharacterTable.applyCharacters | 每次改变排序的刷新建立局部 rank/membership 表，首个重复键、缺失键 -1、零键与原 indexOf 一致；保留 sort、布局、参与状态、present 调用。 |
| B | PartyTranslator.createStatus | 初始技能槽读取三个 summary getter 并保持原 Decimal clamp；去掉仅供这三个字段使用的完整 totalizer 构造。后面的战斗伤害 totalizer 不变。 |
| C | PartyCarousel.getPartyData/applyDetailSetting/applyParty/partyChanged | 详情变更增加 revision，已缓存的当前页及邻页立即刷新；其他已缓存页在下一次访问时刷新。getter 只静默发布数组和 revision，不调用 applyParty 或发送视图命令；保留原 CharacterTop 的显式详情通知，以及 page.present/initialize 读取后 apply 的协议。group 变化失效，applyParty 和跨 SET 的 partyChanged 成功写数组后接受当前 revision，避免再次翻译。initialzeAt/getCurrentPartyData 保留原方法，已由内部 getPartyData 检查 revision。计算异常不标记已刷新，后续访问可重试。 |
| D | CharacterListCachedRepository.find/clearCache | 仅同步复用旧 ID 列表分支参与优化。读取当前排序主键与原固定 tie-breaker，数据相同跳过重复 sort；miss 的 comparator 使用这次标量快照。clearCache、顺序/成员/当前排序数据改变均失效。NaN 或快照异常回到原 comparator。异步查找不变。 |
| E | BattleCharacterLogic.getLearnedManaNodes、PartyTranslator.translate | 单次 translate 的栈式 scope 内复用同对象的节点构造；每次检查能力 id/level、assets identity 与节点公开状态，返回独立数组。结束、异常 catch-all 与嵌套调用均清理对应 scope，无跨调用缓存。 |
| F | CharacterTranslator.getBadgeReasonMethod | 只把 case 0 的角色任务组获取延迟到既有 Lazy 首次求值；创建时仍读取并捕获 repository、int characterId、原 player 对象与 Number time。其他三种徽标分支原指令保留。Lazy 成功结果仍只算一次，异常仍传播且 value 为 None 时可重试。无新的全局缓存。 |

57 个目标/读者方法的精确允许代码指纹见 `method-fingerprints.json`；允许第一批满血 normal summary 复用后的 translate，不接受未知目标或已装本 helper 的输入。未知不相关方法可以组合。输出 JSON 逐方法报告和全局不变性断言，追加的 constant pool 保持全部旧前缀。

## 执行

```powershell
python client-patch/client-data-optimization/patch_swf.py input.swf output.swf
python client-patch/client-data-optimization/tests/test_refusal.py input.swf output.swf
python client-patch/client-data-optimization/tests/run_tests.py input.swf output.swf regression-directory --old-optimized old-r2-data.swf --r3 r3-combined.swf
python client-patch/client-data-optimization/tests/run_badge_tests.py input.swf output.swf badge-regression-directory
```

依赖本仓库 startup-cache 的 ABC/SWF 工具、已有 AIR SDK 51.2.1.5 与 Java；编译显式使用 `-compiler.float=false`，直接得到 ABC 46，不手动修改 ABC 版本。运行前通过 `STARPOINT_AIR_SDK` 指定 AIR SDK 51.2.1.5；`STARPOINT_JAVA` 可指定 Java 可执行文件，默认使用 PATH 中的 `java`。输入与输出必须不同，已有输出不可覆盖。

## 验证边界

AIR 测试嵌入逐字节相同的生产 helper，移植当前游戏的 A/D 完整方法、14 个真实比较器、C 详情/访问方法、E 节点方法、B 初始技能槽片段及真实 totalizer 构造。外围数据、界面入口和逻辑 getter 是有明确边界的夹具；覆盖排序 ties/重复/缺失、当前数据突变、主副位/装备/魂/EX/觉醒/HP/allactive 数值组合、跨组/懒访问/恢复、失败重试和嵌套 scope。translate 清理采用与生产完全相同的插入生成器和真实 AVM2 catch-all 执行；没有在夹具中运行整个完整游戏的 translate。

调用计数与耗时只反映桌面 AIR 的对应夹具，不代表 Android 帧率或完整游戏设备验收。整包组合后的独立方法比较、稀疏回读及 Android 实机测试由集成阶段完成。

2026-10-13 验证：2633 场景、7978 断言通过；生产 helper 字节一致。真实 applyParty、page.present/apply、CarouselView.onPresentCarouselPage 与同步 dispatcher 守卫组合执行，旧 R2 helper 对照复现 G1002；静默 getter 保留跨 SET、详情更改和邻页/旧页恢复的完整数据，通知最大深度为 1，已初始化数组不重复 setup。真实 partyChanged 对照进一步确认基线/R3/修复后的跨 SET 翻译次数为 1/2/1，完整页面数据相同，各自保持一次原通知和落下动画启动。120 个 warm frame 的真实 initialzeAt/getCurrentPartyData 调用没有新增翻译，同组通知仍提前返回。底层 UI 类型有明确的夹具 alias，没有执行完整 Starling 渲染或设备触摸。

B 的 summary getter 为 10→3，attack getter 为 1→0；C 的 12 个缓存队伍即刻重算为 12→3，全部访问后最终 12 次且结果一致。D 的 2048 角色实际 getter 为 75496→6144（miss/hit），本次 AIR 原方法 7ms、miss 5ms、hit 1ms。E 的 11 次 scope 内读取仅构造 3 个节点，正常/异常/嵌套退出后 scopeDepth 为 0。拒绝未知目标、保留已有输出的 3 条断言通过。

F 的专门 AIR 回归为 20 场景、1125 断言，直接移植 13 个真实方法：新旧 getBadgeReasonMethod、原 Lazy 构造/get、任务组构造与筛选、原仓库 getCharacterQuestGroup、原 Bind 构造/执行及 AppTime getter。主表、玩家状态与底层任务判断是明确的夹具。537 个回调创建时，原方法执行 537 次任务组查询与 288369 次主表读取；优化方法执行 0 次。测试读取 16 个可见项后，仅 16 次查询与 8592 次主表读取，其余 521 项 Lazy 未求值；重复 get 不再查询。true/false、首/次/第三角色成员、缺失任务组、player 引用/time/id 捕获、首次读取前玩家状态变更、同时间的旧 group cache、其他三个 case、查询或筛选异常后重试、非有限时间均通过。桌面夹具创建时间 33ms→1ms，不能用此值推算游戏帧率。

角色徽标的实际可见性仍由既有 draw/applyThumbnail 协议控制。没有改变原 Lazy 成功缓存或 CharacterQuestGroup 的时间缓存。延迟查询有两个明确边界：查询错误从列表初始化移到首次徽标求值，仍不吞错或缓存 false；会话内 master/仓库缓存稳定时组内容一致，运行时在首次求值前外部替换 master 或强制删除组缓存不在此修复的等价性覆盖内。真实 QuestRepository 的该缓存在构造初始化并在 getCharacterQuestGroup 写入，未见该类清理路径。原 player 对象是引用，后续对象内部状态变化仍在首次求值时可见，成功 Lazy 后仍返回已缓存值。

本地回归覆盖 2633 场景/7978 断言，徽标专项覆盖 20 场景/1125 断言，另有候选、生产冻结与拒绝路径核验。生产 helper 仅 1 个类、25 个方法 body、26 个静态 trait；ABC SHA-256 为 `acfe2f76f4a746f66dbf2b30dcbc6b05528257fceb21fad5d0a7dd5c48bf30dc`。数据候选 SWF SHA-256 为 `1e62789996e36c644aabcfaa6220805a6749f3e827f2b1bef046427e86efc0ab`。

局部诊断补丁与设备原始计时只存放在 scratch，不进入生产包。Android 同机前测将 viewInitialized 的 2308ms 定位到 537 次徽标回调构造（2145ms）；修复后的独立诊断得到 viewInitialized 115ms、相同 537 次回调构造 2ms，当前 12 个可见徽标截图相符。该结果是一次定位回归的设备样本，不代表所有设备、完整游戏流程或全局帧率验收。getCharacterQuestGroup 的 7 次/163ms 是 draw 前前序场景快照，不能据此推断整个显示过程只执行 7 次。

AIR 报告必须通过 `new File(File.applicationDirectory.nativePath)` 写任务目录；File.applicationDirectory 的资源 URL 不可直接写。真实任务组方法有 CharacterQuestTable 强制类型，夹具提供该类型及真实 MasterMap；IMap/IntMap 的容器只在夹具用 Object.h alias。未使用 Loader 包装运行，以保持 AIR 文档类 application sandbox。
