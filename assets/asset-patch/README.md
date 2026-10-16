# Asset Patch 目录管理

服务端通过 `manifest.json` 与目录位置共同管理客户端资源补丁。

## 目录

- `active/`：当前向客户端发布的 ZIP。
- `inactive/`：暂时停用、以后可能再次启用的 ZIP。
- `archive/`：历史版本归档，不参与发布。
- `production/upload/`：缺失资源的单文件覆盖目录，不属于增量 ZIP 发布。

清单与文件位置必须同步：只修改 `manifest.json` 不能阻止 `active/` 中的 ZIP 被差分列表扫描；只移动 ZIP 但仍将清单条目标为启用，也会造成目标版本与可下载文件不一致。

## 当前版本链

1. `pinball-1.4.55-1.4.56-1-mod-ability-damage-party-balanced-v5.zip`
2. `pinball-1.4.56-1.4.57-1-consolidated-ability-v7-and-custom-drops.zip`

第二个 ZIP 是合并包，包含：

- `ability-damage-party-balanced-v7` 的 15 个最终角色与能力资源；
- 六属性机兵决战级掉落的最终客户端奖励表；
- 机工神兵菲诺梅那地狱级追加掉落的最终客户端奖励表。

旧的 `1.4.56→1.4.57→…→1.4.63` 分段 ZIP 已移入 `archive/`，不再写入发布清单。

## 兼容性

- 合并内容只推进一个小版本号：`1.4.56` 客户端一次更新到 `1.4.57`。
- 已经处于更高资源版本的测试客户端不会降级；部署前建议清理资源缓存，以新的两段版本链重新验证。
