# 资源 IO、批任务与完成阶段优化

适用基线是当前 LAN SWF `9418137820c007b52a11ad0d7955c102795d8dd903213670577bf3407ed709f7`。补丁按方法标签和原指令 SHA 定位，可接在修改其他方法的补丁之后。主 ABC 名为 `boot_ffc6`，不用历史 ABC 序号定位。

## 实现

- FileStreamWithCounter 使用 helper 弱表记录一次性占位。同步/异步打开抛错、原生 IO_ERROR 和关闭 finally 都回退；重复关闭不会重复扣减。排队打开关联请求代次，取消、重开或所属缓存失效后的旧排队项不会打开。同步 open 保留原先同步执行、不按异步上限排队的语义；异步沿用原上限 100。原 Error 3001 到 ClientError 8111 的处理及 Boot.lastError 保持。
- MultiTask 在调用任务前占用槽位，目标同时在途不超过 30。推进游标先于调用，防同步完成重入；每个任务独立一次性回调，重复完成被忽略并计数。启动循环及 progress 返回点都检查取消/失败，任务体或同步进度取消后不启动下一项、不发送迟到 complete。抛错回退未完成槽位、停止后续启动并继续抛出。原 run/add/空队列行为不修改。
- OpenHandler 收取原生文件数据后立即关闭文件，把转换和完成回调分为 decode/deliver。decode 可在 Starling 失活时执行；deliver 保留原 ActivityUtil 活动屏障。队头等待 GPU 的任务不会挡住后续 decode。成功转换不清除可能被 MasterStreamGetter 等保留的输入；失败或取消尚未交付的数据会清除。
- PNG 上传、恢复读与恢复上传进入有界需求调度队列：空闲后请求约 1ms 唤醒，同一 16ms 窗口共享最多 8 个重阶段与 4ms 累计预算，预算耗尽至少等待 16ms。廉价 deliver 不消耗重阶段数，但计入耗时和每轮最多 64 总步骤；总排队容量 1024。失活队头允许后续非 GPU decode 推进，保留各类可执行任务的 FIFO。它是协作预算，单次原生解压、解析或同步上传不可抢占，仍可能超过 4ms。PNG 保留原同步 Texture.fromBitmapData/uploadBitmapData，像素在上传结束 finally 释放；取消或重复输入也释放像素。
- ATF 原 callback 式异步上传保持，增加失效检查及一次性回调：未启动的取消请求清除 bytes，已在途的取消请求在原生完成后 dispose 新纹理，不交付到缓存。
- ViewAssetCache 的任务/直接纹理读取携带所有者；dispose 取消相关文件、阶段及恢复。恢复请求有代次，新的请求淘汰尚未执行的旧读和旧回调数据。共享 root 的恢复仍可服务剩余已知所有者；最后一个已知所有者取消后不再迟到上传。
- 统计保存在内存，最多 32 条阶段耗时/排队等待记录及有界累计峰值，不逐帧写磁盘。纹理按唯一 root/nativeWidth/nativeHeight/format/mips 估算字节数，已知 LRU 的真实 root dispose 和缓存 dispose 回退记录。所有者集合为弱键，元数据和代理不引用 root，不为统计长期保留纹理。

新增唯一 DoABC `cn.optimize.resources.ResourceRuntime`，原生编译 ABC46（显式 `-compiler.float=false`），没有手工降版。23 个原主 ABC 方法变化：11 个方法体移植、12 个可逆插入。游戏实例、继承、trait 布局不变，旧池前缀不变，其他方法/tag 保留。`donor/` 的 game 类型是编译及夹具依赖，只选取指定方法体，绝不把这些类定义交付到游戏。

## 运行

运行前通过 `STARPOINT_AIR_SDK` 指定 AIR SDK 51.2.1.5；`STARPOINT_JAVA` 可指定 Java 可执行文件，默认使用 PATH 中的 `java`。

```powershell
python client-patch/client-resource-optimization/build_assets.py <assets-directory>
python client-patch/client-resource-optimization/patch_swf.py INPUT.swf OUTPUT.swf --assets <assets-directory>
python client-patch/client-resource-optimization/run_air_harness.py TEST_OUTPUT_DIRECTORY --source OUTPUT.swf --assets <assets-directory>
```

`patch_swf.py` 要求输出不存在，核验原方法指纹与编译资产 manifest，写回读确认所有 tag。资产目录须包含本目录脚本构建的 `manifest.json`、`runtime.swc` 与 `donor.swc`；补丁通过 `--assets` 或 `STARPOINT_RESOURCE_ASSETS` 指定。patch 报告给出精确方法/body 集合、编译源 SHA 和 helper ABC SHA。输入可含其他组的独立方法变化。

## 验证与边界

资源优化候选 SWF 的 SHA256 为 `cf74305697e288806589b6d7c3afd5a6ae8f5152fe3a7c734c4f0e250517245a`，helper ABC SHA256 为 `34e48afdcbb4569e4c9827895f8a8e4e31a093aaf9189ad259f930ecc55c0d47`。本地 AIR 回归：163 断言（原 158 项及新增 5 项调度边界），21 个生产方法体与 helper 从候选 SWF 原字节码移入 AIR 夹具，归一化指令/异常表相等，ADL exit 0。原生 FileStream/ByteArray/BitmapData 覆盖 120 次打开异常后恢复、实际延后 missing-file IO_ERROR、真实 async COMPLETE、重复 close、排队取消、95 个慢任务在途峰值 30、同步重入/重复完成/throw/空队列、任务体取消、同步 progress 取消和最后一项 progress 取消、真实 inflate/JSON 解析失败、失活 decode 与 GPU 等待、取消后 bytes/bitmap 释放、80 项上传负载、恢复代次与共享所有者、ATF 迟到取消。

本轮增量仅修改 helper 调度及有界统计，原 23 个主 ABC 方法模板、donor、patch_swf.py 均不变；与上一资源候选的整个 boot_ffc6 主 ABC 字节完全相同。功能夹具只为新的跨调用预算增加有界等待，不削弱原断言。

另有桌面 AIR 原生异步文件/AMF 解压解析/PNG Loader 的 7 阶段角色链 A/B，依据本地 A/B 记录。6/24/72 角色在交叉重复中到齐中位数为 R3 的 117/359/1065.5ms、需求调度的 84/222/696ms；此为受控桌面负载，GPU 工厂与 atlas 消费者受控。重阶段不能抢占，早期 A/B 观察到单 job 10ms、后续基线重复有 12ms；4ms 是启动下一 job 的协作预算，不是硬耗时上限。单 phase 排队 P95/最大值没有一致下降，不据此保证每个请求更快。

Texture 工厂、Activity 状态、ProgressManager 和 Haxe Date 依赖受控；原 run 的 Date QName 仅在夹具映射到 FixtureClock。ViewAssetCache 的完整资源/场景没有在夹具实例化，owner 插入通过可逆字节码及布局核验。该结果不等于 Android 设备、整游戏/原生 ANE、GPU 实测验收。

纹理统计只覆盖已知缓存的加载根，不是全屏 Mesh 可见引用或 GPU 驱动的精确占用；GC 或其他未命中的释放入口可能使累计估算残留，不能据此自动淘汰。没有改变 LRU 容量、淘汰策略、纹理格式、native 清理、设备/服务/CDN/准入登记；没有据此声称帧率或 GPU 收益。原生 PNG Loader 自身的损坏图片 IO_ERROR 路径未改写，当前回归验证的是转换失败与已解码 BitmapData 的上传/取消生命周期。

本轮改善范围是资源请求已经发出后的阶段等待和到齐延迟，不解决已经观察到的角色一览首入约 2.5 秒前置同步停顿；资源缓存命中且队列为空时的切页掉帧也需另查。实际 Android 的 Timer 精度、PNG 解码与 GPU 上传耗时仍需同设备 A/B。

设备补充证据：本地设备剖析记录中的 CharacterScene.viewDidChange/CharacterTable.initialize snapshot 含单 PNG 上传 15ms 和 43ms。当前同步上传仍不可抢占；新需求调度只控制下一项开始，不把 4ms 写成硬限制，也不保证左右切页帧时间。CharacterList.viewInitialized 约 2310ms 的前置初始化由另一独立路径处理。
