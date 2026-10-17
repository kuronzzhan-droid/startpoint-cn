# 服务端内存诊断与分配优化

当前诊断默认值已由 [服务端常驻监测与详细诊断](server-diagnostics-modes.md) 更新：常驻轻量汇总，深度内存与 Windows 原生探测默认关闭，SQL 采样使用独立开关。以下保留原内存修复的实现和验证记录。

本批改动减少 NPC 阵容同步、种子 JSON 持久化和重复 SQL 编译产生的分配，并按分钟记录主线程、后台线程及业务容器的状态。RSS 是否持续增长仍须通过部署后的时序数据判断；单次 RSS 或堆内存采样不能证明泄漏。

## 运行行为

- NPC 普通通关只同步变化的阵容及淘汰玩家 ID；启动和重载按关卡发送快照，收到主线程确认后再发送下一关，最后原子替换缓存。每关保留最近通关的 50 名玩家阵容；同一玩家再次通关覆盖原记录，启动和重载也整理现存超限记录。战力和属性仍用于抽选准入，数据库表和玩家删除语义不变。增量序号异常会请求完整重载。
- 种子持久化仍使用现有 JSON 主文件与 `.bak`，保留后台合并、成功确认、失败重试和关闭前 flush。直接分块编码 Map，避免先复制为完整 Object 再生成巨型字符串；写入临时文件后 fsync 并校验回读摘要，保留有效旧主文件作为备份，再原子替换。首次写入或检测到外部替换时仍验证旧 JSON。新文件使用紧凑 JSON，解析结果兼容原格式。仍写完整快照，未引入日志文件或修改持久性窗口。
- 任务与计数查询、NPC 线程查询复用 SQL statement，每个数据库连接最多缓存 128 个，以 LRU 淘汰；连接通过 WeakMap 隔离。只供已审查的 get/all/run 调用使用，不缓存查询结果，不修改 SQL、事务或奖励规则。正在迭代的 statement 不复用。
- 每 60 秒向 stderr 输出一行 `[MEM]` JSON，无请求时也采样。不开启强制 GC、堆快照或高频全表扫描；监测最多保留 32 个业务计数器、16 个线程及每线程一个最近样本，每线程最多一个未返回的采样请求。

## 如何读日志

使用启动脚本现有的 stderr 日志，筛选 `[MEM]`。单位为字节，除特别注明外计数器为当前数量。比较相同 PID、不同运行时长、相近负载下的连续数据，尤其是业务低峰时的低值是否不断抬高。

| 字段 | 用途 |
| --- | --- |
| `rss` | 整个 Node 进程的驻留内存，不能与各线程重复相加 |
| `main.heapUsed / heapTotal / external / arrayBuffers` | 主线程 JS 堆、已分配堆及关联外部内存；arrayBuffers 已包含在 external 中 |
| `workers[].memory` | `npcPool` 与 `seedPersistence` 各自的堆、外部内存及 V8 辅助指标，不包含重复的进程 RSS |
| `workers[].ageMs / stale / pendingMs` | 后台线程样本年龄与未回复时间；首次采样可能是 null，通常下一分钟可见；样本不是与主线程严格同时取得 |
| `counters.npcPool` | 活跃关卡池数、阵容数、普通候选缓存、待发送/处理中记录、删除请求、就绪状态及重载状态 |
| `workers[name=npcPool].counters` | 处理中操作、累计记录数、累计发送阵容数和累计完整刷新数 |
| `counters.seedQueueN` | 待处理更新、正在写入更新、等待 flush 的请求及写入确认版本 |
| `workers[name=seedPersistence].counters` | 种子池与条目数、脏文件数、累计写入次数、流式路径累计写入字节及批次数 |
| `counters.rooms / sessions` | 房间阶段、会话容器、心跳/返房/废弃战斗计时器等的当前规模 |
| `counters.finishCache / battleSnapshots / settlementBarriers` | 结算响应缓存、战斗快照和结算屏障数量 |
| `counters.tcpSendQueue` | 应用层可靠发送队列中的消息与字节，不含操作系统 socket 缓冲 |
| `counters.sqlStatements` | 主线程 statement 命中、编译、淘汰和 busy 绕过的累计次数，以及每连接缓存上限 |

`writeCount`、`writeBytes`、`batches`、`records`、`publishedEntries`、`fullRefreshes`、SQL 命中/淘汰次数及 `droppedBeforeReady` 是累计计数，正常情况下也会增长，不等同于内存占用。种子和关卡池条目数随实际业务增加也可能是合理增长。

若某线程堆低值与其容器数量一起持续增加，可优先检查对应保留对象；若待处理队列长期不回落，优先检查消费速度或写入错误。若主线程、后台线程和业务容器稳定而 RSS 持续升高，继续检查原生分配、SQLite、内存映射及分配器保留；不能简单把 RSS 减去 heapTotal 就认定为泄漏。

### 离线汇总工具

将 stderr 日志拷回分析机，在项目根目录运行：

```powershell
node tools/analyze-memory-log.cjs "C:/path/to/cn-server.stderr.log"
node tools/analyze-memory-log.cjs --json "C:/path/to/earlier.stderr.log" "C:/path/to/later.stderr.log"
```

第一种输出可读报告，第二种输出 JSON。包含首次/最后值、增量、按观察区间折算的每小时变化和最小/最大值；不足 10 分钟不估算每小时变化，增长不等于泄漏。多文件须按时间先后提供，PID 或运行时长回退会分段，线程按 threadId 区分。跳过过期线程样本，并从容器增长排名中排除累计次数和版本号。旧日志缺少 `[MEM]` 时明确提示数据不足，不从原有 RSS 字段推断后台线程内存。

工具只读日志，逐行处理，不连接数据库、不在服务进程中运行、不保存全部样本。最多保留 32 个进程片段、每片段 384 项指标，达到上限时报告省略数量；建议分开分析不同机器的日志。需 Node 24 LTS，无第三方依赖。独立工具文件为 `tools/analyze-memory-log.cjs`，可按需随运维资料交付，不是服务启动依赖。

## 独立停用开关

均默认开启；环境变量在启动进程前设置，修改后重启生效。

| 环境变量 | 设置为 `false` 的效果 |
| --- | --- |
| `MEMORY_DIAGNOSTICS` | 停止周期日志与线程探测 |
| `NPC_INCREMENTAL_UPDATES` | 普通更新退回单关卡全量快照；启动/重载仍使用分关卡确认协议 |
| `SEED_STREAM_WRITES` | 使用原有种子全量 Object/JSON 原子写入路径 |
| `SQL_STATEMENT_CACHE` | 每次重新 prepare SQL |

无需依赖变更、数据库迁移、新客户端或 CDN 增量。存档 schema、已有 ID、账号归属及 V1/V2 导入导出协议保持不变。所有新的辅助模块必须随调用方共同交付，不能只覆盖 worker 或单独覆盖主线程文件。

## 本地验证

Node v20.20.2、Windows 下完成 TypeScript 隔离构建，并回归种子失败重试/重启恢复/flush、JSON 回读损坏与备份复制失败、NPC 裁剪/立即淘汰/删除空池/重载/重启、SQL 绑定与事务回滚、监测待处理请求有界和监听器回收。相关任务领取防重复、抽卡反馈、多人可靠发送/槽位/房间准入与解散、旧存档兼容测试通过。测试使用隔离目录和数据库；未对真实玩家执行导入或购买。

两组隔离合成负载使用同一实现的独立开关进行对照，采样峰值不是操作系统记录的绝对峰值：

| 工作负载 | 原路径 | 优化路径 |
| --- | --- | --- |
| 约 8.2 万条初始种子，连续 80 次保存：RSS 采样峰值 | 196.5 MiB | 99.4 MiB |
| 同上：总耗时 | 4.32 秒 | 2.07 秒 |
| 32 个关卡，每关 50 份约 4 KiB 阵容，2,000 次更新：发送阵容数 | 100,000 | 2,000 |
| 同上：RSS 采样峰值 | 158.7 MiB | 119.9 MiB |
| 同上：更新阶段耗时 | 1.33 秒 | 0.35 秒 |

NPC 对照的最终数据库内容摘要一致。抽卡对照的最终 JSON 解析结果一致。以上仅说明这些负载下的分配和耗时改善，不预测云服的固定节省量，也不证明长期 RSS 增长已消除。生产监测不强制 GC；种子隔离试验只在最后额外采样时执行 worker GC。

## 运行文件范围

下列 17 个 TypeScript 模块和对应 17 个 `out/` JavaScript 为本批运行改动。发布时核对这些文件及共享路径上的其他已批准改动：

```text
src/lib/memory-diagnostics.ts
src/lib/cached-statement.ts
src/lib/route-performance.ts
src/lib/seed-stream-file.ts
src/lib/seed-persistence.ts
src/lib/seed-persistence-worker.ts
src/data/domains/mission.ts
src/lib/mission/counters.ts
src/multi/npc/quest-party-pool-cache.ts
src/multi/npc/player-party-pool.ts
src/workers/quest-npc-party-pool-worker.ts
src/multi/room/manager.ts
src/lib/finish-response-cache.ts
src/multi/settlement-snapshot.ts
src/multi/settlement.ts
src/multi/state/SessionManager.ts
src/multi/tcp/reliable-send.ts
```

功能回归入口为 `tests/server-memory-optimizations.test.js`。本批已备份并同步本地运行镜像，重启后 HTTP 8001、多人 TCP 8003 和 NPC 阵容池就绪，后台状态及真实服务 V2 只读导出验证通过。手机游玩验收及长期内存观察待完成；尚未部署云服。

离线分析回归入口为 `tests/memory-log-analysis.test.cjs`，覆盖线程/容器增长、累计计数过滤、时钟回退与进程重启、重复/过期样本、状态上限、CRLF 日志读取、旧日志与缺文件处理。

隔离联调使用真实 Fastify 实例及 NPC、种子后台线程，完成 4 次采样与日志汇总，核对两个线程的堆指标和 NPC 缓存条目增量，并正常关闭实例与线程。该短时联调只验证诊断链路，不代表长期压力测试或云服验证。
