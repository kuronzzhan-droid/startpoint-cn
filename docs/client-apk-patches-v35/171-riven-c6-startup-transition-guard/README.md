# 171 — 武器裂罅 C6：修复未登录场景切换调用 getLoadedData 导致的 C2001（1008057）

## 作用

修复 C4 在 `LogicScene/finishTransition` 挂载裂罅冲突提示时未先检查 `LogicStatus.loadedData` Option 状态的问题：当 `loadedData` 为 `Option.None`（标题页/登录前场景切换）时直接完成原场景切换返回，避免触发 `getLoadedData()` 抛出的 C2001 异常。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `LogicScene` | `finishTransition` | C6 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 无新增配置，常驻生命周期保护

## 依赖的前置补丁

- `169-riven-c4-conflict-and-dismantle`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c6
