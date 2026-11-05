# 星见镇的摇曳原生技能场景候选

六个技能页分别使用独立的 `GachaSkillPreview` 键、技能预览关卡、`FieldData`、`Field`、`Zone`、地形和回放。新关卡保留匹配供体的参数，`Field` 和 `Zone` 引用已有美术、物件和敌人资源。十二份新增地形与回放文件使用已离线验证演出资源的原字节。

- [MASTER-ROWS.json](MASTER-ROWS.json) 是五张表的增量行。`Zone` 的 `copyExactNestedRow` 指向母表中的完整原生嵌套行，合并时复制该行的已存储字节。
- [RESOURCE-MANIFEST.json](RESOURCE-MANIFEST.json) 记录六条引用链、十二个新资源的相对路径和 SHA256，以及作者主分支 CDN 1.4.351 上的母表身份。
- [VERIFY-PROOF.json](VERIFY-PROOF.json) 记录六条编码后的场景链读回，以及奈芙提姆独立关卡 928 的 C8601 桌面原生复录。其 322 张原始画面与已验收短版逐字节相同。
- 技能关卡 923–928 在清单所列作者主分支基线上未占用，作为待分配编号。接入前须以实际启用分支与有效母表重新查重。需要调整编号时同步更新 `GachaSkillPreview` 的 `quest_id` 与 `SkillPreviewQuest` 行键。
- 卡池外层 `GachaFeatureContent` 和选池横幅由配套变更接入。候选场景只提供技能页引用，未分配发布资源版本，也未启用。
