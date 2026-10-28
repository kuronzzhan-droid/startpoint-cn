# 168 — 武器裂罅 C3：武器一览「裂罅」分类切换、筛选排序与道具分组（1008054）

## 作用

在武器一览右上角复用教程按钮位增加「装备 ↔ 裂罅」分类切换；裂罅分类下列出 `saveData.weapon_rivens` 中的已揭示实例（编码键 `0x05000000 | item_id`），支持按词条数/负面词条筛选及按重抽次数/词条数排序；在 `ItemTableTranslator` 中将裂罅归入独立虚拟分组。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `AbilitySoulThumbnailListRepository` | `translate` | C3 方法级字节码插片（详见 `pcode/`） |
| `ComplexThumbnailView` | `culling` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentFilterDialog` | `dialogButtonClicked` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentFilterDialog` | `prepare` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentFilterDialogContentView` | `run` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentFilterDialogView` | `run` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `bulkSellDialogHandler` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `bulkUpgradeDialogHandler` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `buttonClicked` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `changeProtection` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `checkButtonClicked` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `filterDialogOkHandler` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `getFilteredEquipmentList` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `getFilteredEquipmentListAsyncCompleted` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `openBulkSellDialog` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `openDetailDialog` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `rebuildAllThumbnails` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `selectEquipment` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `sortEquipmentThumbnails` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListScene` | `toThumbnailData` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListTableItemView` | `apply` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListTableItemView` | `setSelected` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListView` | `setupHowToButton` | C3 方法级字节码插片（详见 `pcode/`） |
| `EquipmentListView` | `setupPanelList` | C3 方法级字节码插片（详见 `pcode/`） |
| `FlipperGroupTitleView` | `run` | C3 方法级字节码插片（详见 `pcode/`） |
| `ItemCategoryKindTools$` | `getUiStringId` | C3 方法级字节码插片（详见 `pcode/`） |
| `ItemTableTranslator` | `translateFromCategorizedItems` | C3 方法级字节码插片（详见 `pcode/`） |
| `ItemTableTranslator` | `translateFromItem` | C3 方法级字节码插片（详见 `pcode/`） |
| `PanelContainerTitleView` | `run` | C3 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `apply` | C3 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `draw` | C3 方法级字节码插片（详见 `pcode/`） |
| `PanelInnerContentItemListTableView` | `run` | C3 方法级字节码插片（详见 `pcode/`） |

## 开关或数据写法

- 编码实例键：`0x05000000 | item_id`（与普通装备 ID 隔离）

## 依赖的前置补丁

- `167-riven-c2-reforge-and-detail`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c3
