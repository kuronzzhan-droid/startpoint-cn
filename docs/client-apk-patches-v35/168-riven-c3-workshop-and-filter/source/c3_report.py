"""Produce the Chinese delivery report from finalized C3 receipts."""
import json
from bootstrap import ROOT, WORKSPACE, FINAL, BASE_SHA, require_hash, sha
from c3_config import APK, PACKAGE_REPORT, VERSION_CODE, ADMISSION_BUILD


def read(path):
    return json.loads(path.read_text('utf-8'))


def main():
    build = read(ROOT / 'audit/build.json')
    tests = read(ROOT / 'validation/all-results.json')
    package = read(PACKAGE_REPORT)
    review = read(ROOT / 'audit/independent-c3.json')
    assert build['status'] == tests['status'] == package['status'] == 'passed'
    assert review['status'] == 'passed_no_new_material_findings'
    swf_sha = require_hash(FINAL, build['sha256'])
    assert swf_sha == tests['swf_sha256'] == package['swf_sha256'] == review['swf_sha256']
    apk_sha = require_hash(APK, package['apk_sha256'])
    identity = package['receipt']['build_id']
    methods = '\n'.join(f'| `{label}` | {item["body"]} | {", ".join(build["owners"][label])} |'
                        for label, item in sorted(build['changed'].items(), key=lambda pair: pair[1]['body']))
    suites = '\n'.join(f'| {name} | {row["case_count"]} | `{row["report"]}` |'
                       for name, row in tests['suites'].items())
    protected = read(ROOT / 'audit/protected-method-hashes.json')
    hashes = '\n'.join(f'| `{name}` | {row["method_count"]} | `{row["c3_sha256"]}` |'
                       for name, row in protected.items())
    input_count = len(read(ROOT / 'audit/input-lock.json')['inputs'])
    text = f'''# 武器裂罅 P1 客户端 C3 交付报告

日期：2026-10-26。依据：`C3-BRIEF.md`、`../P1-CONTRACT.md`，基线为 C2 APK 1008053／SWF `{BASE_SHA}`。

## 1. 本地交付与构建身份

**本地实现、离线验证和 local x86 档 APK 已完成。** 所有离线结果绑定同一个最终 SWF，共 **{tests['case_count']} 个案例通过**。没有安装设备、部署、更改服务端、推送 Git、调用付费 API 或 hearthbot。本目录及祖先没有 Git 仓库，因此没有初始化仓库或创建提交。C1／C2 与任务依据共 {input_count} 个输入文件纳入保全核对，C2 产物未覆盖。

| 项目 | 最终值 |
|---|---|
| APK | `{APK}` |
| APK SHA256 | `{apk_sha}` |
| APK 字节数 | {APK.stat().st_size} |
| versionCode | **{VERSION_CODE}** |
| AIR uniqueappversionid | **`{identity}`** |
| DEX BuildIdentity.ID | `{identity}` |
| 准入握手 build | **`{ADMISSION_BUILD}`** |
| SWF | `{FINAL}` |
| SWF SHA256 | `{swf_sha}` |
| 包名／服务器档 | `com.leiting.wf` ／ local `<SERVER_HOST>:8001` |
| 实际 ABI | `arm64-v8a`、`x86_64`（继承 C2 的 x86 档双 ABI） |

最后修改 APK 的步骤是哈希锁定副本 `build-c3/source/nocache/apk_nocache.py: refresh()`，此后只读取验证。签名、zipalign、manifest 版本、AIR UUID、DEX 身份和内嵌 SWF 回读通过。除签名成员外，相对 C2 仅 AndroidManifest.xml、classes.dex、assets/worldflipper_android_release.swf 改变，其余资源与 native 库逐字节相同。打包内部还回读验证 `cn/startpoint/` 以外的 smali 未改变。

## 2. 页面与操作说明

以下为实现流程的文字说明，不是设备截图。

### 武器一览

复用原页右上教程按钮资源，显示“装备 → 裂罅”；点击后变成“裂罅 → 装备”。裂罅分类只枚举 `saveData.weapon_rivens` 中的已揭示实例，每个 item_id 独立一行；同武器多张保持多行。行上显示绑定武器图标、“<武器名>裂罅”、词条条数、重抽次数。未知裂罅在道具与编成魂珠页堆叠显示。

裂罅行使用 `0x05000000 | item_id`，与裸装备 ID、教程键 `0x01000000`、筛选与批量按钮隔离。点击进入既有 C1／C2 魂珠详情，保留动态能力描述、绑定武器、次数和重抽入口。出售、觉醒、强化与批量保护不可用于裂罅。分类切换清空批量选择并重设筛选；裂罅列表不接受旧装备 finder 结果，装备模式的晚到回调按当前筛选重新计算。

### 裂罅筛选与排序

复用现有装备筛选对话框：文本框按绑定武器名称匹配（忽略大小写）；七个原属性控件变为 1条、2条、3条、4条、有负、无负、不限；条数可多选，负面筛选与条数组合。“按重抽次数”切换排序主键，“升序排列”改变方向；默认按获得顺序由新到旧。重抽次数相同按获得顺序再按实例键稳定排序。

负面判定来自本地生成器 `weapon_riven_affixes.json` 的明确 polarity，并对照 `affix_keys.lock.json` 固定哈希与键映射，不由词条等级或中文描述推测。未识别的新词条仍能在不限制负面的列表中显示；显式有负／无负筛选排除无法可靠判定的记录。普通装备筛选保留原有语义。

### 道具一览与编成魂珠选择

道具页在翻译后的展示分组中单列“裂罅”，包含未知裂罅 16000000 和 16000001–16000200 实例；原 item 主表 category 始终为 5。未知裂罅保留持有数量，实例保留各自 ID 和数量 1。

编成魂珠选择沿原 repository 按 item_id 枚举，保留未装备／已装备两种原行键。裂罅缩略图增加“<武器名>裂罅”文字，未知显示“未知裂罅”和原堆叠数量；同武器多实例能够独立选择。文字使用现有字体与 TextField，未增加美术文件；只有含裂罅名称的网格增加行高，并处理名称清理和更新。带名称的缩略图裁剪范围覆盖新增文本，普通图标与其余裁剪边界保持原逻辑。

## 3. 修改方法与结构约束

相对 C2 主 ABC 修改 **{build['changed_method_count']} 个既有方法体**，其余 {build['preserved_c2_body_records']} 个完整方法体记录不变。全部主 ABC 改动为单方法 P-code 拼接，反拼接可逐字节恢复 C2 原指令。`assert not editor.new_methods and not editor.traits` 通过，没有新增运行时方法、类或 trait。方法／实例／类／脚本／元数据／命名空间表保持不变；主 ABC 原常量池前缀不变，仅追加所需常量或 QName。

| 方法 | ABC body 索引 | 模块 |
|---|---:|---|
{methods}

另同步替换准入身份的三处常量字符串：`cn/admission/ClientAdmission` 中 transport 的声明 build、prove 闭包的 `SP-ADMISSION-1\\n<build>\\n` 消息前缀，以及 `cn/admission/BuildConfig.ID`。所有方法指令、header、协议字段与凭据不变。两个准入 ABC 的原始字节在恢复这三处字符串后逐字节等于 C2；保留原始常量池编码，未经非等价的整块重新序列化。主 ABC、ClientAdmission 与 BuildConfig 三个 ABC 之外的 SWF 标签逐字节不变。

四个禁改类共 562 个命名方法／构造器完整记录均与 p13 相同；未修改共享攻击计算。

| 类 | 方法数 | p13 = C3 聚合 SHA256 |
|---|---:|---|
{hashes}

## 4. 离线测试与证据边界

| 验证组 | 案例数 | 结果文件（build-c3/validation/） |
|---|---:|---|
{suites}

本次执行最终 SWF 中实际序列化的方法或明确列出的指令切片。C3 覆盖分类往返、空列表、同武器多实例、筛选／排序、行键及详情点击、异步旧结果、普通装备与普通魂珠回归、布局更新及准入字符串。继承 C1／C2 的 175 个案例覆盖存档、公共响应、能力与动态名称、TypePacker、重抽交易、演出和普通 EX。

准入测试执行实际 transport 握手对象及 prove 消息构造的指令切片，验证 `protocol=1`、`platform=android`、声明／证明／BuildConfig 的 build 一致；用合成测试密钥验证消息与服务端 proofMessage 公式一致，未使用真实密钥执行认证，也没有发网络请求。其他宿主对原生容器、UI 节点、Gear、主表、纹理与网络响应使用明确适配器。**未执行 AIR 验证器、真实屏幕排版、设备登录、实机战斗或在线服务端事务；离线通过不等同于真机验收。** 具体方法执行计数、案例与边界见逐组 JSON；施工 candidate 不计入最终案例数。

集成过程中已修正普通装备异步回调的批量选择集合、名称复用清理、网格更新及新增文本的顶部裁剪范围。封包预检还拦截了早期准入仅修改 transport、遗漏证明前缀及 BuildConfig 的不完整变更：现已同步修正三处，新增一致性用例并重跑最终验证。最终交叉复核记录为 `build-c3/audit/independent-c3.json`，早期候选不作交付。

## 5. 契约偏差与实现选择

1. **获得时间按获得先后排序。** HTTP 下发及 C1 存档没有 created_at，使用契约保证单调且不复用的 riven_id 表示获得顺序；UI 明确写“获得顺序”，不展示或推造时间戳。未改服务端契约或存档 schema。
2. **教程按钮资源复用。** 武器页原教程入口被装备／裂罅切换替代；没有新增美术或枚举／方法。切换时重设当前分类筛选，不持久保存两套筛选历史。
3. **准入字符串为明确授权的常量改动。** `{ADMISSION_BUILD}` 是本包独立握手 build；为保持既有认证协议，声明、签名消息前缀及配置常量同步到该值，凭据与算法不变。服务端应登记对应 build／既有凭据映射并授予 `weapon-riven-v1`。本次没有修改服务端准入配置，未验证服务端实际授予能力。AIR／DEX UUID 与此准入字符串是不同身份体系，报告分别列出。
4. **虚拟裂罅组仅用于 UI。** 分组 key 与 item_id 位于不同容器，不更改真实 category=5，也不重新定义魂珠协议。实例仍由原 item_id 区分，未知仍按数量堆叠。
5. **负面目录固定到当前生成器版本。** C3 构建会校验目录与 key lock 哈希；未来增加或改变词条 polarity 时需更新客户端映射并回归。
6. **x86 档继承双 ABI。** 与 C2 一致保留 arm64-v8a／x86_64，不是 32 位 x86 专包。

## 6. 真机／服务端验收步骤（本次未执行）

1. 服务端准备未知、200 个实例 item／ability_soul 行及词条主表，并将准入 `{ADMISSION_BUILD}` 授予 `weapon-riven-v1`；旧 build 保持原能力范围。另行设备授权后安装 APK，读回 versionCode {VERSION_CODE}、AIR UUID `{identity}` 与实际加载 SWF 哈希。
2. 准备空实例账号及含同武器多张、不同武器、1–4 条、有／无负面、不同重抽次数的账号。武器页切换分类，验证图标、名称、条数、次数、空页及长名称／长文本排版；检查批量出售、觉醒、强化、保护在裂罅模式无入口或副作用。
3. 组合测试名称、条数、负面筛选、重抽／获得顺序与升降序，取消／重置／确定；返回普通装备检查属性与关键字筛选、排序、保护及批量功能。
4. 在装备异步查找尚未结束时切裂罅、快速往返、连续应用不同筛选；晚到回调不得覆盖当前列表。打开每张同武器实例详情，确认重抽作用于所点 item_id，返回后数据刷新一致。
5. 道具页检查独立“裂罅”组与普通魂珠组；编成换珠检查未知数量、同武器多实例独立选择、已装备行复用、名称清理和网格间距。测试长中文武器名、空列表与滚动裁剪。
6. 重抽后分别保留新／旧，返回并重新进入列表，核对词条数、负面筛选、次数排序及 pending 恢复；登录重载验证获得顺序不依赖可复用 item_id。
7. 回归普通魂珠选择／详情、普通 EX、C1 单人冻结与武器匹配；联机仍遵守 P1 服务端实例去珠策略，本包没有启用联机裂罅效果。

## 7. 复核与构建入口

```powershell
python -B build-c3/source/c3_build.py
python -B build-c3/validation/c3_validate.py
python -B build-c3/source/c3_package.py --preflight-only
python -B build-c3/source/c3_package.py --check-only
# 正式封装拒绝覆盖已有交付 APK：
python -B build-c3/source/c3_package.py
python -B build-c3/source/c3_report.py
python -B build-c3/source/c3_seal.py
```

- `build-c3/audit/build.json`、`audit/pcode/`：方法清单、插入位置、静态检查、反拼接与源码哈希。
- `audit/protected-method-hashes.json`：四禁改类逐方法完整记录哈希。
- `audit/admission-identity.json`：唯一准入字符串及原始字节还原证据。
- `audit/filter-affix-catalog.json`：负面键来源与固定哈希。
- `audit/input-lock.json`、`input-preservation.json`：输入保全。
- `validation/all-results.json`、逐组 JSON 与执行日志：绑定最终 SWF 的离线结果。
- `build-audit/riven-p1c3-apk-final.json`：末步 nocache、签名与 APK 回读证据。
- `C3-DELIVERY-MANIFEST.json`、`SHA256SUMS.txt`：最终文件封存清单。
'''
    (WORKSPACE / 'C3-REPORT.md').write_text(text, 'utf-8')
    print(json.dumps({'status':'written', 'report':str(WORKSPACE / 'C3-REPORT.md')}))


if __name__ == '__main__':
    main()
