# 幻想连战纯净端构建工具

示例安装位置：`<server-root>\tools\fantasy-gauntlet-mod-tools`

## 仅校验（不写入）

```powershell
python .\wf_mode15_build.py --server-root '<server-root>'
```

## 写入纯净端当前资源（不发布增量）

```powershell
python .\wf_mode15_build.py --server-root '<server-root>' --write
```

除非明确准备发布，否则不要追加 `--publish`，也不要手工修改
`assets\asset-patch\manifest.json`。

当前工具已包含：15关数据、5/15关通用试炼、10关领域链、15关护盾、
统一商店和服务端镜像生成逻辑。
