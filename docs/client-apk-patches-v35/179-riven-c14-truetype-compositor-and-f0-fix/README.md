# 179 — 武器裂罅 C14：修复重铸页打开即 F0（#1023 栈溢出）与 TrueTypeCompositor 递归收敛（1008075）

## 作用

定位并修复重铸页与二选一框在关闭 HTML 后读取旧标题宽度触发 `TrueTypeCompositor/renderText` 超纹理尺寸无限递归导致的 F0（Error #1023 栈溢出）：在赋新标题前先设置安全文本，并在 `TrueTypeCompositor/renderText` 超尺寸递归分支中加入字号下界收敛保护。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `BoxButtonContentView` | `addTextField` | C14 方法级字节码插片（详见 `pcode/`） |
| `DialogItemTitleView` | `run` | C14 方法级字节码插片（详见 `pcode/`） |
| `ExBoostDetailView` | `createText` | C14 方法级字节码插片（详见 `pcode/`） |
| `ExBoostInformationAbilityView` | `applyExAbility` | C14 方法级字节码插片（详见 `pcode/`） |
| `ExBoostSelectDialogView` | `run` | C14 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `draw` | C14 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `onApplyExBoostInformation` | C14 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupButtons` | C14 方法级字节码插片（详见 `pcode/`） |
| `ExBoostWindowView` | `setupExBoostInformationWindow` | C14 方法级字节码插片（详见 `pcode/`） |
| `TrueTypeCompositor` | `renderText` | C14 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 无新增配置

## 依赖的前置补丁

- `178-riven-c13-asset-group-and-page-layout`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c14
