# 编队动画等待的存活性修复

Android 角色替换的 EditOnce 路径会先锁输入，再等待所有已初始化队伍的加入或移除动画完成。既有轮播优化只更新当前队伍；如果其他队伍保留未结束的 fall 或 kachidoki，完成判断可能一直失败。等待中的 20 帧是完成后的延迟，不是超时。该代码条件可导致输入锁不解除；尚不能把它认定为所有设备画面冻结的原因。

补丁只在 `PartyCarousel.update` 原完成判断前插入指令：等待状态为 Waiting 时，扫描已初始化的非当前队伍；发现任意 cell 的 `isJoinOrRemoving()` 为真，便推进该容器一次。平时只读等待状态，不扫描或推进离屏容器；空队、未初始化队伍和已经结束动画的队伍都不更新。当前队伍仍由原代码推进一次。没有初始化所有队伍、常驻更新邻居、删除动画或用超时伪造完成。

保留原完成谓词、20 帧等待、清空旧等待状态后调用回调的顺序、输入锁机制、队伍资料和触摸保护。没有新增游戏类、字段、方法签名、常量池或持久化数据。只增加该方法的四个局部变量。

## 字节码边界

`patch_swf.py` 默认输入为本批核验的上一版 LAN SWF SHA-256 `9418137820c007b52a11ad0d7955c102795d8dd903213670577bf3407ed709f7`。通过类与方法标签定位，另锁定原 update 指令哈希；历史方法编号不作为定位依据。在该输入中，DoABC ordinal 为 299、SWF tag 为 362、update 方法体为 66361（method ID 72281）。插入 47 条指令；包括循环回跳目标所需的两个真实 AVM2 `label` opcode。其余 96,705 个方法体、池、类布局和 SWF 标签保持。

当前切队初始化保护 `changeIndex` 方法体 66403、空触摸保护 `beginTouch` 方法体 65893 逐字节保持。补丁证明插入可逆、栈及作用域合法，并从写出的 SWF 回读每项字段及方法体。没有重编译整个游戏类。

```text
python -B client-patch/party-animation-liveness/patch_swf.py <当前SWF> <新的输出SWF>
```

整合其他已核验补丁后，可显式传入 `--expected-input-sha256 <本次直接输入哈希>`；原 update 指令哈希与布局检查仍不可绕过。APK 封包、AIR UUID、签名和最终载荷验证由单独入口完成；本脚本不制作 APK 或修改登记。

## AIR 回归与证据范围

```text
python -B client-patch/party-animation-liveness/run_air_harness.py <新的工作目录> --game-source <当前核验SWF>
```

运行器使用既有 AIR SDK，隐藏窗口，先编译测试夹具，再插入与生产相同的指令块。编译显式禁用 ZWS 压缩与 float ABC 扩展，保留已支持的 ABC 格式；不改写生产 SWF 的 ABC 版本。随后把当前客户端的下列实际方法移植进夹具，只映射夹具类型和作用域，保留方法指令及控制流：

- `PartyCarousel.haveAllCellsJoinOrRemoveAnimationFinished`。
- `PartyCharacterCellContainer.update`。
- `CharacterCell.isJoinOrRemoving`、`isFalling`。
- `CharacterCellCharacterPlayhead.get_isPlayingKachidokiOnce`。

18 项 ADL 断言覆盖未修复对照、修复后回调恢复、fall 和 kachidoki 的完成条件、多个 cell 不重复推进容器、当前队伍不重复更新、空队/未初始化队伍、无等待时零离屏扫描、快速多队切换、回调仅一次/可重入、取消后的无遗留异步任务、错误正常传播，以及普通单队角色替换。夹具的动画底层与画面资源受控；等待控制器由原逻辑表达，未移植完整 `PartyCarousel.update`、真实资源加载和全游戏场景。不能把 ADL 夹具通过当成设备复现或手机卡死已经消除。

首次只运行静态栈/指令检查的候选在实际 ADL 执行时触发 VerifyError 1021。汇编器的 `(label, name)` 仅定义偏移，不输出 opcode；在循环后跳目标插入真实 `0x09` 后，生产相同插入块及实际完成谓词均通过 ADL。静态 `check_body` 不能替代 AVM2 运行验证。

最终设备验证应区分输入被锁而动画继续，与整个渲染主循环停住；记录等待状态、当前队伍及离屏队伍序列，验证普通编辑与 EditOnce、跨队伍分类后迅速切队、替换后返回、连续操作。此修复不承诺解除所有主线程资源加载或计算阻塞。
