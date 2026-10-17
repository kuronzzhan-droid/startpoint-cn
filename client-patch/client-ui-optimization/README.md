# 客户端 UI 差量更新与动画池修复

同路径动画池取出一个对象后保留尚有对象的桶；正常释放成功后清空桶索引，避免再次释放同一批对象。角色列表保留数据完全相同的已有 view，减少重复回池、绑定和 clone。稳定隐藏 cell 暂停无待完成动画的逻辑更新；稳定隐藏轮播页在完成一次共享显示树清理后跳过外围 draw。

## 组合与边界

```powershell
python -B client-patch/client-ui-optimization/patch_swf.py input.swf output.swf
python -B client-patch/client-ui-optimization/patch_swf.py input.swf output.swf --helper ui-helper.swc
python -B client-patch/client-ui-optimization/tests/run_tests.py input.swf fresh-test-directory
```

输出及测试目录必须尚不存在。脚本使用既有 startup-cache/party-animation-liveness 的 ABC parser、assembler 和 importer；SDK 与 Java 入口见脚本常量。编译仅用于新增 `cn.optimize.ui::UiOptimization` helper 和受控测试夹具，不重编译游戏类。

按下列八个原方法的代码指纹拒绝未知输入，允许其他组已修改不相关方法。输入可基于已核验 LAN SWF `9418137820c007b52a11ad0d7955c102795d8dd903213670577bf3407ed709f7` 或保留这些目标方法指纹的组合候选。不得对已应用 UI helper 的输出再次应用。

| 类 | 方法 | 当前 body |
| --- | --- | --- |
| PixelArtCharacterAnimationPool | getOrCreate / dispose | 65850 / 65851 |
| CharacterTableView | present / applyPatch / dispose | 66173 / 66180 / 66179 |
| CharacterTable | updateCells | 66116 |
| PartyCarouselPageView | draw / dispose | 66662 / 66663 |

主 ABC 的已有方法签名、成员、traits 和元数据保持原样；常量池只追加所需引用。插入可逆，回读检查所有非目标方法和 tags 保持输入原样，保护先前 PartyCarousel.update 的等待动画修复。另新增一个 helper ABC，包含一个类、15 个方法和 15 个 bodies。这里的 body 数值仅描述当前输入，脚本以类/方法标签定位，以原代码指纹校验。

## 失效与生命周期

列表比较完整输入数据的结构快照，涵盖参与状态、皮肤/像素动画、缩略图、角标、装备、底座以及额外字段；深复制 Haxe enum 参数可发现同 key 下的原地变化。稳定条目复用已有快照与 view，不逐次 JSON 序列化。未知对象类型、非有限数值、循环或超出深度/节点预算时，仅将该条目标记为每次 present 都重新绑定，不影响其他可比较条目；尤其 Some(Lazy) 角标不提前求值，也不按 Lazy identity 判作相同。无效数据/重复 key 在任何 UI 修改前返回原 present 路径。applyPatch 先失效相关快照；dispose 清理弱引用缓存。实际绑定错误保留原异常，不降级吞错；开始物理修改前撤销旧快照，使失败后的重试重新完整绑定。

动画池只在桶空时删除 key，正常 dispose 后移除普通及保留字桶索引；不做跨桶所有权去重。已经取出的活对象继续由原 view 管理，池内对象沿用原释放方法。

不可见 cell 的 fall、一次胜利动画及衔接标志、非默认 motion、延迟、气泡播放和渐暗 tween 都继续更新。可见视口内 cell 保持原更新。未知/非静止状态按保守条件继续更新，原缺失 key 报错保留。

updateCells 的暂停分支位于原 z/alpha 同步之后，只跳过 playhead 更新。即使整个表的 wholeAlpha 归零，所有 cell.alpha 仍同步到零；恢复时同帧同步透明度并恢复动画，避免 view 仍读取前帧不透明状态的残影。

可见 cell 的判定严格匹配 CharacterCellView 的绘制交集：保留中心两侧 96px 的部分可见区域，并包含 safeArea 的非零起点。CharacterCell.isWithInScreen 是较窄的滚动聚焦判定，不能用于停止动画；它会把仍在绘制的边缘角色判作不可见。

隐藏页首次仍运行原 draw，随后清理共享魂珠图、底座和点击区；上次已完成隐藏清理、当前仍隐藏、fade 未变且共享 cell/魂珠图/底座/点击区全隐藏时才跳过。CarouselView 在滚动时改变所有页的坐标，持续隐藏页无需因此重新 draw；真实 refreshScroll 仍负责设置位置、初始化可见页和可见状态。恢复可见、邻页转场或外部共享层可见变化重新运行原 draw。dispose 先撤销页缓存，原显示树释放保持原样。

## 验证范围

AIR 回归将当前游戏的完整旧/新 AVM2 控制方法移植到夹具，执行实际新增 helper，并移植真实 CharacterCellView.apply、数据 clone 和动画完成谓词。覆盖同路径多项池、保留字桶、释放一次、同 key 字段/皮肤/参与失效、过滤/排序/拖拽所有权、patch、错误重试、隐藏 pending 动画、恢复/取消、共享显示树清理和退出释放。底层纹理、资源、显示对象及时间线推进由夹具控制；接口调用命名空间只在夹具中映射到同名公开方法。

初批本地 AIR 回归为 56 断言、ADL exit 0。受控场景中 40 个稳定隐藏 cell 的 20 帧调用从 800 次降至 0；隐藏页 31 次 draw 降至首次清理的 1 次；稳定列表避免再次 apply/pool。这些是夹具调用计数，不能换算为设备性能百分比。实际游戏资源、Android 设备帧率、触摸拖拽和退出生命周期仍需组合包设备检查。

后续角色一览本地回归为 84 断言、ADL exit 0。在已有控制方法之外移植真实 focus/draw 边界、CharacterCell.update/updatePlayheads、角色 playhead.advanceFrame/advanceFrameUsually 及 timelineLoadHandler；新增 20 帧可见角色连续动画、部分可见边缘、滚动进入/离开/返回、时间线异步完成、非零 safeArea 起点、隐藏/重开透明度同步，以及 120 帧持续隐藏页移动、外部魂珠点击区恢复可见、转可见首帧恢复。时间线底层和资源完成事件受控，不包含实际 APK 或纹理加载时延测量。已确认边缘动画停止和隐藏透明度滞留缺陷；中心角色全部静止及整体加载变慢尚不能据这些离线证据归因。原未选择列表的 neutral 状态与选中编队角色后的随机动画必须区分，不能用预载 walking 时间线的夹具替代该设备对照。

最终本地 AIR 回归为 89 断言、ADL exit 0，保留上述回归并新增实际 Lazy 构造器/get 字节码：真实 clone/apply 保留 Lazy 身份与延迟缓存求值，present 不调用 getter；连续刷新保留物理 view 并重新绑定该行，混合列表的可比较邻行仍跳过重复绑定，applyPatch 保留完整数据。

按需分配 view 仅保留为独立 scratch 原型，未纳入生产；实际计时的 537 项首次 present 为 81ms，其中 view 创建 48ms、apply 10ms，不能据此认定约 2.5 秒停顿主要来自 view 创建。15 类历史动画源码与 7 月已修改发布包一致的结果，只能限定该历史区间；官方原始客户端行为仍待原件核对。

运行前通过 `STARPOINT_AIR_SDK` 指定 AIR SDK 51.2.1.5；`STARPOINT_JAVA` 可指定 Java 可执行文件，默认使用 PATH 中的 `java`。
