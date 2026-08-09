# 国服角色语音黑名单解除（待合并）

状态：`pending_merge`。

> 本补丁不得单独放入 `assets/asset-patch/active`，不得加入当前服务端整合包，也不得部署到本地测试端。后续收到其他客户端资源补丁时，再把本补丁中的资源合并到对方补丁。

## 资源与构建信息

- 逻辑资源：`master/string/ui_string.orderedmap`
- 哈希路径：`d6/88e4a5f7d84cc422357cc8acbdb72817bc8670`
- 修改键：`character_voice_exclude`
- 构建脚本：`tools/build_character_voice_unlock_patch.cjs`
- 待合并产物：`assets/asset-patch/inactive/pinball-1.4.59-1.4.60-1-character-voice-blacklist-unlock.pending-merge.zip`

## 修改内容

将国服原表 `character_voice_exclude` 的 12 条代码全部清空：

| 角色 ID | 项目内简称 | code_name |
|---:|---|---|
| 151001 | 普黑（奈芙提姆） | `ruin_girl` |
| 151009 | 礼黑（奈芙提姆） | `ruin_girl_halfanv` |
| 321002 | 水剑 | `urban_soldier` |
| 221002 | 水奶 | `bishop_girl` |
| 251010 | 光水奶 | `bishop_girl_smr20` |
| 211006 | 火弹 | `red_gunner` |
| 221022 | 春伞 | `urban_soldier_ny21` |
| 151063 | 浴黑（奈芙提姆） | `ruin_girl_smr21` |
| 111045 | 火尼 | `magical_bayonetter` |
| 211001 | 龙骑 | `dragon_slayer` |
| 211038 | 泳龙骑 | `dragon_slayer_smr21` |
| 311008 | 小火尼 | `berserker` |

客户端 `noPlayVoice()` 使用子串匹配，因此移除 `ruin_girl` 后，还会恢复原表没有单独列出的第三周年奈芙提姆 `ruin_girl_3halfanv`。最终影响范围是奈芙提姆 4 个版本加其余 9 个角色，共 13 个角色版本。

## 合并要求

后续合并时，应以此补丁里的 `master/string/ui_string.orderedmap` 修改为准，并与同版本其他 UI String 修改做键级合并，不能简单让两个含相同哈希资源的 ZIP 互相覆盖。
