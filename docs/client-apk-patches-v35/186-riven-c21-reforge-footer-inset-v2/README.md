# 186 — 武器裂罅 C21：重铸页底部面板按导航背景顶线紧凑布局（inset 175 方案 2）（1008082）

## 作用

按作者确认的方案 2 将重铸页面板底边由 `safeArea.bottom - 291` 下移至 `safeArea.bottom - 175`（距导航背景条顶线留 14 逻辑单位），释放 116 逻辑单位给词条滚动区，并固定费用文字与道具选择格相对视口底部的间距且水平居中。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `ExBoostWindowView` | `draw` | C21 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `onApplyExBoostInformation` | C21 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C21 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExBoostInformationWindow` | C21 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 无新增配置

## 依赖的前置补丁

- `185-riven-c20-reforge-footer-safearea`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c21
