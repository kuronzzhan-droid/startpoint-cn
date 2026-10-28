# 181 — 武器裂罅 C16：恢复重铸页与二选一弹窗词条中的原生 <icon> 图标与实体富文本（1008077）

## 作用

修复 C13 对词条描述调用 `htmlEscape` 导致 `<icon id=...>` 与 `&nbsp;` 原样外露的问题：在 `ExBoostInformationAbilityView/applyExAbility` 与 `ExBoostDetailView/createText` 的转义后追加两步正则替换，精确恢复原生 `<icon>` 标签与合法 HTML 实体。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `ExBoostDetailView` | `createText` | C16 方法级字节码插片（详见 `pcode/`） |
| `ExBoostInformationAbilityView` | `applyExAbility` | C16 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 无新增配置

## 依赖的前置补丁

- `180-riven-c15-loaded-data-getter-guards`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c16
