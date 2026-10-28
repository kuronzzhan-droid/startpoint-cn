"""Render the Chinese C1 delivery report from sealed local evidence."""
import json
from pathlib import Path
from bootstrap import ROOT, WORKSPACE
from c1_config import VERSION_CODE, APK, SWF, PACKAGE_REPORT


def read(relative):
    return json.loads((ROOT / relative).read_text('utf-8-sig'))


def main():
    build = read('audit/build.json')
    tests = read('validation/all-results.json')
    package = json.loads(PACKAGE_REPORT.read_text('utf-8'))
    protected = read('audit/protected-method-hashes.json')
    assert build['status'] == tests['status'] == package['status'] == 'passed'
    assert build['sha256'] == tests['swf_sha256'] == package['swf_sha256']
    identity = package['receipt']['build_id']
    method_rows = '\n'.join(
        f"| `{name}` | {row['body']} | {row['static_check']['instructions']} |"
        for name, row in build['changed'].items())
    protected_rows = '\n'.join(
        f"| `{name}` | {row['method_count']} | `{row['c1_sha256']}` |"
        for name,row in protected.items())
    report = f'''# 武器裂罅 P1 客户端 C1 交付报告

日期：2026-10-26。执行依据：本目录 `C1-BRIEF.md`、上级 `P1-CONTRACT.md`。

## 1. 交付状态与文件

**本地代码、离线验证和 local x86 档 APK 已完成。未安装设备、未部署或修改服务端、未推送 Git、未调用付费 API 或 hearthbot。** 本目录及祖先没有 `.git`，因此没有初始化仓库或创建提交。

- APK：`{APK}`
- APK SHA256：`{package['apk_sha256']}`
- APK 字节数：{APK.stat().st_size}
- versionCode：**{VERSION_CODE}**；唯一配置为 `build/source/c1_config.py`。
- SWF：`{SWF}`
- SWF SHA256：`{build['sha256']}`
- AIR `uniqueappversionid`／DEX `cn.startpoint.BuildIdentity.ID`：**`{identity}`**。
- 包名：`com.leiting.wf`；继承 local 服务器地址 `<SERVER_HOST>:8001`。
- 文件名为 x86 档；实际继承 ABI 是 `arm64-v8a`、`x86_64`，不是 x86 32 位专用 APK。
- 制作末步：复制的、哈希锁定的 `build/source/nocache/apk_nocache.py: refresh()`；此后只做读取验证，没有再次写包。

基线 SWF 为 P0c（SHA256 `{build['baseline_sha256']}`）；包壳使用 P0c 已签名 APK（SHA256 `{package['base_provenance']['sha256']}`）。构建代码与依赖复制到本目录 `build/`，p0 的 36 个源文件／输入文件已做前后哈希校验，全部不变。p13 SWF 仅作为方法恢复和禁改类对照。

## 2. 实际实现

### 存档与公共响应

登录 `rawData.data.user_weapon_riven_list` 先校验、深复制到登录转换对象，再由 `restoreFinishedHandler` 接入 `LoadedData.player.weapon_rivens`。玩家存档形态是普通动态 Object，不是 `IntMap` 或 `StringMap`，访问时不需要 `.h`：

```text
saveData.weapon_rivens["16000001"] = {{
  riven_id: Int,
  weapon_id: Int,
  affixes: [[key:Int, L:Int], ...],
  roll_count: Int,
  revision: Int,
  next_cost: Int,
  pending: null | {{draw_id:String, affixes:[[key:Int, L:Int], ...]}}
}}
```

`draw_id` 的 String 类型已只读核实并行服务端 `src/lib/weapon-riven/model.ts`，不是从未标类型的契约推测。

公共响应新增 `weapon_riven_list:Object` 和 `weapon_riven_deleted:Array<Int>`，缺省分别为 `{{}}` 和 `[]`，不套 Option。`applyCommonResponse` 替换下发的整条记录、保留未返回记录，再执行删除；同 ID 同时出现时删除优先。裂罅变化会设置原方法的“存档变化”返回值，接续既有刷新链。

仅接收 16,000,001–16,000,200 的实例键；16,000,000、预留区和无关 ID 不进入实例字典。当前及 pending 词条要求 1–4 条，每条 `[key,L]`，key 为正整数、L 为 1–100 整数。登录／公共响应解析重建记录、数组和 pending；后续更新通过整条替换，不改写已记录的旧响应对象。

### TypePacker

已同时补齐 `PlayerSaveData`、`CommonResponse` 的字段类型 map、字段白名单和 optional 名单。扩展字段 optional 用于兼容旧日志／旧存档。四个类型描述键 `c1.WeaponRivenAffixes`、`c1.WeaponRivenPending`、`c1.WeaponRivenRecord`、`c1.WeaponRivenList` 均在已有 `resolveMap2201` 中注册；使用现有 `COLLECTION`、`ANONYMOUS`、`DYNAMIC_ACCESS`，没有新增 AS3 类或方法。

`LoadedData` 不增加重复根字段；既有 `player:PlayerSaveData` 会递归保存整个字典、当前词条和 pending，已通过实际 TypePacker 往返测试。

### 战斗生产与详情

`PartyLogic.getBattleParty` 从 `this.player.saveData.weapon_rivens` 按三槽魂珠 item_id 取当前记录；逐标量构造新快照，保持 P0b 已验证的类型：

```text
weapon_rivens: Array<Option<Array<Int>>>
Some([item_id, weapon_id, key1, L1, key2, L2, ...]) / None
```

这个 flat 格式属于本场快照；HTTP／玩家存档仍使用契约对象和二维词条数组。快照不引用存档数组，后续更新、删除或修改 pending 不会反向改变已生产的本场数据。`BattleCharacterLogic.getAbilitySoulAbility` 的 P0c consumer 原样保留，继续只从本场快照取数和按同槽绑定武器门控。

`GeneralAbilitySoulLogic.getAbility` 读取当前 `affixes` 构造能力；有 pending 时也不展示候选词条。每条仍使用现有 `MinToMaxLevelScale(L,1,100)`，复用 P0 聚合算法及原有返回类型。无存档记录回落原路径。

`ItemLogic.get_name` 对实例 ID 返回装备主表名称＋`裂罅`，两者之间无空格；缺少存档记录时返回 item 主表原名（主表需按契约提供“武器裂罅”）。详情利用原 message 区显示真正换行的两行：

```text
绑定武器：<武器名>
已重抽 N 次
```

三处本地 UI 查询在调用 `get_player()` 前检查 `logicStatus.getPlayerSaveData()`，未登录时回落原路径，避免 C2000。四个原 P0 官方载体 1010001、1060001、1080001、2020001 恢复官方能力路径；未知裂罅和范围外魂珠也保留原路径。

## 3. 方法改动与禁改边界

相对 P0c 修改 {build['changed_method_count']} 个现有方法，保留其他 {build['preserved_p0c_body_records']} 个完整方法体记录。两个原 P0 字面量方法先恢复 p13 原体，再作插入；每个方法均验证移除本次插入后可以恢复指定基体。

| 方法 | ABC body 索引 | 最终指令数 |
|---|---:|---:|
{method_rows}

`assert not editor.new_methods and not editor.traits` 已通过。methods／instances／classes／scripts／metadata／namespaces／namespace sets 原样；常量池仅追加字符串和两个范围整数，已有常量与所有 multiname 不变。主 `boot_ffc6` 外的 SWF 标签逐字节不变。

四个禁改类共 562 个命名方法／构造器完整记录逐个与 p13 对比一致。以下聚合 SHA256 按方法体索引顺序拼接完整记录（含 header、code、exceptions、body traits），p13 与 C1 值完全相同：

| 类 | 方法数 | p13 = C1 SHA256 |
|---|---:|---|
{protected_rows}

逐方法哈希在 `build/audit/protected-method-hashes.json`。没有修改共享攻击计算。

## 4. 离线验证与实测边界

最终 SWF `{build['sha256']}` 对应 **{tests['case_count']} 项全部通过**：

| 验证组 | 通过数 | 覆盖 |
|---|---:|---|
| 存档接线／合并 | {tests['suites']['save']['case_count']} | 登录与恢复、增改删、删除优先、未知 ID、非法词条、pending 深复制、原公共响应分支 |
| 动态能力／名称／详情 | {tests['suites']['dynamic']['case_count']} | 三槽生产、深冻结、当前词条与 pending 分离、武器匹配、合击边界、动态名／回落、两行 message、四官方魂珠 |
| TypePacker／快照链路 | {tests['suites']['typepacker']['case_count']} | PlayerSaveData／CommonResponse／LoadedData 往返、pending、空值、严格模式、旧字段兼容、生产→序列化→消费 |

验证执行最终 SWF 中真实字节码：`PlayerLogic.applyCommonResponse`、生产端、消费端、能力入口、名称和详情初始化使用完整方法；TypePacker 使用实际注册和简化／具体化实现。登录和公共响应的巨型解析方法使用从最终 SWF 提取的本次插入指令切片，周围局部变量由 fixture 提供，**没有执行完整登录网络状态机**。原生 Object／Array／枚举／类分配、主表输入、UI 构造与渲染回调存在明确适配器；其中主表数据混合官方样本和明确标记的合成 fixture。**这些离线结果不等于 AIR 验证器、设备渲染或实战伤害验收。**

保存与动态两组首次通过；TypePacker 首次因测试宿主缺少既有 `TypePacker.resolveType` 绑定失败，补齐对真实方法的绑定后单独重跑通过，未以 Python 重写 TypePacker 算法。最终汇总和来源哈希在 `build/validation/all-results.json`，详细边界在 `build/validation/README.md`。

APK 校验通过：包名与 versionCode、新 AIR UUID、DEX BuildIdentity、签名、zipalign、SWF 回读字节一致、ZIP 无重名。相对 P0c 除签名成员外仅 `AndroidManifest.xml`、`classes.dex`、`assets/worldflipper_android_release.swf` 改变；其他资源与 native 库逐字节保留。DEX 打包时回读验证 `cn/startpoint/` 以外的 smali 不变。

## 5. 构建身份与契约偏差

1. **AIR／缓存构建身份与准入握手身份是两套值。** 本包 AIR UUID 与 DEX BuildIdentity 都是 `{identity}`，可用于精确标识本 APK。实际 `cn/admission/ClientAdmission` ABC 的 `transport()` 发出 `build = "<ADMISSION_ID>"`，本次原样继承；`BuildIdentity.ID` 在 StartupCache 中用于缓存清理标记，没有自动传入这条准入握手。只读核实的服务端 `src/lib/client-admission.ts` 以 authenticated grant 的 `build` 查询能力。因此，**按当前实现，不能仅把 AIR UUID 写入准入配置就声称已单独放行 C1**；给继承的 local build ID 授予 `weapon-riven-v1` 也会覆盖使用相同 ID 的旧本地包。本次没有修改准入协议、凭据或服务端配置。服务端配置者须先解决独立准入身份／映射后再限定启用；证据见 `build/audit/admission-identity.json`、`admission-transport.json`。
2. **快照保留 P0b flat 编码**，没有为 `{{weapon_id, affixes}}` 重做战斗 schema。它由契约存档字段生成，信息等价，减少对已验证 consumer 和恢复路径的修改。
3. **LoadedData 不增新根字段**，通过既有 player 的 PlayerSaveData schema 递归保留，已验证。
4. **x86 档保留基线双 ABI**（arm64-v8a／x86_64）；没有擅自删 native 库或另外制作 ARM 包。
5. **构建工具修正一处静态检查假设**：原登录方法声明 max_scope=7，但解析得到的实际峰值是3，原工具把“峰值必须等于上限”误作要求。仅在本目录副本 `vendor/framework.py` 改成拒绝“超过上限”；原header不变，独立栈／作用域／异常边界检查仍执行。此项只改变离线补丁工具，不改变客户端算法。

客户端没有新增能力自报字段。上述身份偏差和未做设备验收是实际交付限制，不能写成已完成服务端启用或真机生效。

## 6. 交接与真机验证步骤（本次未执行）

1. 服务端准备与本包对应的独立准入判定，明确授予 `weapon-riven-v1` 的客户端集合；先处理第5节共享握手 ID 问题，核查旧客户端仍按契约过滤。数据侧预注册未知裂罅、200个实例 item／ability_soul 行以及所用 affix 主表键。
2. 按另行设备操作授权安装本包，读回 versionCode {VERSION_CODE} 和 AIR UUID `{identity}`，确认运行的 SWF 为本报告哈希；本次已做 nocache，现场仍应核查实际加载包身份。
3. 登录带至少两张不同绑定武器裂罅的账号；核对 `<武器名>裂罅`、绑定武器、已重抽次数、不同等级的当前词条。无存档实例主表名应为“武器裂罅”；未知裂罅与四官方珠保持原表现。
4. 经服务端响应增加、更新、删除实例；确认列表与详情刷新、其他记录保留，删除同时清理编队引用由服务端返回完成。断线重新登录后核对相同记录和 pending 恢复。
5. 制造当前／候选明显不同的 pending；详情仍显示当前词条。服务端选用候选后再查看，应刷新为新当前词条和新 revision；丢弃则保留旧当前词条。
6. 单人分别装备匹配／不匹配绑定武器，在主位检查效果；合击不重复生成。开战后服务端改变卡片，验证本场冻结不变；恢复／重载及下一场读取正确快照。
7. 检查详情两行 message 的实际换行、高度、长武器名与多词条布局。离线只验初始化传值，不替代屏幕验收。
8. 按 P1 联机去珠策略核对房间本人／队友／重连／换队数据中的实例槽编码 `[1]`，允许无珠开战且不擦除保存编队。此项属于服务端联调，本客户端包没有新增房间能力启用。

## 7. 构建与证据入口

现有交付已封装，打包脚本拒绝覆盖不同内容的已交付 APK。

```powershell
python -B build/source/c1_build.py
python -B build/validation/run_all.py
python -B build/source/c1_package.py --preflight-only
python -B build/source/c1_package.py --check-only
# 仅在尚无交付 APK 的新输出副本中执行正式封装：
python -B build/source/c1_package.py
```

- 构建及每个拼接方法的静态检查：`build/audit/build.json`、`build/audit/pcode/`。
- 禁改类哈希：`build/audit/protected-method-hashes.json`。
- 输入保全：`build/audit/input-lock.json`、`build/audit/input-preservation.json`。
- 离线验证：`build/validation/all-results.json` 与三组 `*-results.json`。
- APK 回执：`build/build-audit/riven-p1c1-apk-final.json`。
- 独立复核：`build/audit/independent-c1.json`。
- 最终文件清单：`build/C1-DELIVERY-MANIFEST.json`、`build/SHA256SUMS.txt`。
'''
    (WORKSPACE / 'C1-REPORT.md').write_text(report, 'utf-8')
    print('Wrote C1-REPORT.md')


if __name__ == '__main__':
    main()

