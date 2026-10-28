# 153 地狱南瓜直击试炼条兼容强化弹射（P-a）

- 首发版本：v35k-pa / 1008010（并作为 run12–run21 底包前置合入 1008011+）
- capability：`hell-pumpkin-pf-trial-v1`（P-a）
- 依赖前置补丁：无特殊 WFX 前置（基于 v35k / 1008009 底包修改，后续被 144–152 及 154+ 继承）
- 对应数据边：地狱南瓜副本数据边（敌人代号前缀 `mod_hp_`，如 `mod_hp_pumpkin_p1_d_multi` 等）

## 作用

使地狱南瓜王副本中原本要求直击（`TrialKind.DirectAttack`，case 0）的试炼条同时接受强化弹射（PowerFlip）命中。在 `HitCountCheck/matchTrial` 的 `DirectAttack` 分支中，原直击（`param1 == true`）照常通过；当 `!param1 && param3`（即非直击但属于 PowerFlip 命中/状态/回复）时，读取 `owner.getMasterId()` 提取敌人代号字符串，若以 `"mod_hp_"` 开头则同样放行计入试炼进度，不影响任何非 `mod_hp_` 敌人的直击试炼。

## 改动类与方法

- `HitCountCheck/matchTrial`（`boot_ffc6`，body `58641` / method `63326`）：等长替换 `[0xA0, 0xAA)` 的拒绝返回为 `param3` 门控跳转，并在方法末尾 `0xF6` 追加 `owner.getMasterId()` 前缀 `"mod_hp_"` 检查；仅尾增 1 条字符串常量 `"mod_hp_"`，不新增方法、槽或类。

## 开关与数据写法

- 无外部开关；按敌人主表代号前缀 `mod_hp_` 自动识别。

## 最终 P-code

- [matchTrial](pcode/matchTrial.pcode.txt)；文件 SHA256 `e2743d7e96adc2a4ae2b861290a908ea708d1dc7b9ea15e4bb05d65ef3864d6b`（`方法 HitCountCheck/matchTrial；body=58641；method=63326`）。

## 补丁源与构建脚本

`source/` 保存本补丁的指令构造与构建脚本快照：

- [pa_common.py](source/pa_common.py) ← `pa_common.py`；SHA256 `6a140b8e4cd9ed723dd846849838fc9ebf8f9f29aac789e24eeed01de7199b72`。
- [pa_integrity.py](source/pa_integrity.py) ← `pa_integrity.py`；SHA256 `403143db351bd8e353a58beef9850fcf8c121809aaf408136b3f1e2cba93b958`。
- [pa_pair.py](source/pa_pair.py) ← `pa_pair.py`；SHA256 `250dc6f4f334cc2bcaa54bd4013fd7526d0bf9ac9bdb915cda886ba66f924179`。
- [pa_patch.py](source/pa_patch.py) ← `pa_patch.py`；SHA256 `f9da61ae28e8492b4ce8c1a7c361ae1db85570c92f5efcc9742c0d082386cc68`。
- [pa_semantics.py](source/pa_semantics.py) ← `pa_semantics.py`；SHA256 `b1a709007155a0c7e0576fe4713c074b31fa79024744d8f78cebaa55e572d4d0`。
- [patch_pa.py](source/patch_pa.py) ← `patch_pa.py`；SHA256 `08d406e4ee0156584ed07a64f926f8314c54753df03a4fcf8124e8ee383e830b`。
- [verify_pa.py](source/verify_pa.py) ← `verify_pa.py`；SHA256 `d50e7d3d816ca62feffe5dd97e2bb2d59934a4e7465e42b3b97075797c8b16e6`。

## 已知限制与验收边界

- 仅对代号前缀为 `mod_hp_` 的 Boss/Funnel/Zako 敌人生效；SkillChain 的 `param1/param2/param3` 均为 `false`，不会误触发。
- 测试服 `v35k-pa.swf` SHA256 `6ff86f5f84d06dc5b5ff98be9df0c3eb7475de5daea7dfdd4dee653120bd8efb`，改动后方法 code SHA256 `389dfb038cde555efff0045798f54e2711a1a397f2d52a236305adfc8878a3d3`。

来源工作区：`<WORKDIR>/outputs/apk/hell-pumpkin-20261020`
