# 185 — 武器裂罅 C20：重铸页底部面板与按钮上移避让全局导航栏（inset 291）（1008081）

## 作用

修复 C19 重铸页面板底端（`safeArea.bottom - 32`）被底部全局导航栏遮挡的问题：按导航图标动画最高帧上沿预留 `safeArea.bottom - 291`，同步上移面板底边、三按钮行并收敛词条滚动视口高度。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `ExBoostWindowView` | `draw` | C20 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `onApplyExBoostInformation` | C20 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C20 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExBoostInformationWindow` | C20 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 无新增配置

## 依赖的前置补丁

- `184-riven-c19-select-button-and-race-fix`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c20
