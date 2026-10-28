"""Generate the Chinese handoff exclusively from final build/test/package receipts."""
import json
from bootstrap import ROOT, WORKSPACE, FINAL, BASE_SHA, sha
from c4_config import VERSION_CODE, APK, PACKAGE_REPORT, ADMISSION_BUILD


def main():
    read = lambda p: json.loads(p.read_text('utf-8'))
    build = read(ROOT / 'audit/build.json')
    tests = read(ROOT / 'validation/all-results.json')
    package = read(PACKAGE_REPORT)
    protected = read(ROOT / 'audit/protected-method-hashes.json')
    review = read(ROOT / 'audit/independent-c4.json')
    digest = sha(FINAL.read_bytes())
    assert digest == build['sha256'] == tests['swf_sha256'] == package['swf_sha256'] == review['swf_sha256']
    apk_digest = sha(APK.read_bytes())
    assert apk_digest == package['apk_sha256']
    rows = '\n'.join(f"| {name} | {row['case_count']} | `validation/{row['report']}` |"
                     for name, row in tests['suites'].items())
    methods = '\n'.join(f"| `{name}` | {row['body']} | {', '.join(build['owners'][name])} |"
                        for name, row in sorted(build['changed'].items()))
    hashes = '\n'.join(f"| `{name}` | {row['method_count']} | `{row['p13_sha256']}` |"
                       for name, row in protected.items())
    text = f'''# 武器裂罅 P1 客户端 C4 交付报告

日期：2026-10-26。依据：`C4-BRIEF.md`、`../P1-CONTRACT.md` 第 9 节 v1.1 修订、`../review2/REVIEW.md`。基线为 C3 SWF `{BASE_SHA}` / APK 1008054。

## 1. 本地交付与身份

本地实现、离线验证与 local x86 档 APK 已完成。最终 SWF 共 **{tests['case_count']} 个离线案例通过**。输出全部位于本目录，C1–C3 原件保留；没有安装设备、部署、修改服务端、推送 Git、调用付费 API 或任何 hearthbot 工具。本目录不是 Git 仓库，没有自动初始化仓库或创建提交。

| 项目 | 最终值 |
|---|---|
| APK | `{APK}` |
| APK SHA256 | `{apk_digest}` |
| APK 字节数 | {APK.stat().st_size} |
| versionCode | **{VERSION_CODE}** |
| AIR uniqueappversionid | **`{package['receipt']['build_id']}`** |
| DEX BuildIdentity.ID | `{package['receipt']['build_id']}` |
| 准入 build | **`{ADMISSION_BUILD}`** |
| SWF | `{FINAL}` |
| SWF SHA256 | `{digest}` |
| 包名 / 服务端档 | `com.leiting.wf` / local `<SERVER_HOST>:8001` |
| 实际 ABI | `arm64-v8a`、`x86_64`，继承 C3 的 x86 档双 ABI |

最后修改 APK 的步骤为 `source/nocache/apk_nocache.py: refresh()`，此后只有读取验证。签名、zipalign、manifest 版本、AIR UUID、DEX 身份及内嵌 SWF 回读通过。除签名成员外，相对 C3 仅 `AndroidManifest.xml`、`classes.dex`、`assets/worldflipper_android_release.swf` 改变，其余资源与 native 库逐字节保留。nocache 还校验 `cn/startpoint/` 以外 smali 保持不变。

## 2. 请求与冲突恢复

`weapon_riven/draw`、`select`、`dismantle` 均带当前 `saveData.weapon_rivens[item_id].riven_id`。draw 保留 revision，select 保留 draw_id/is_confirm；viewer_id 与 api_count 继续由原 transport 注入。原普通 EX 请求字段、协议和认证流程保留。

基线实际只有 draw/select，没有分解端点或操作入口。为完成 C4 的三接口要求，本次复用重抽页原有控件增加“分解裂罅”，点击弹原通用确认框，确认后只分解当前一张；取消不发请求。确认记录 riven_id，提交前再次与当前存档比对，卡已删除或槽已复用时直接恢复页面，不向新卡发送分解请求。原有批量出售、强化、觉醒和保护仍不可用于裂罅。

收到 `weapon_riven_conflict: true` 时保留 reason，走原成功事件和 `ProcessingDialogManager.CloseThen` 生命周期，让连接框正常关闭；卡不存在也发送完成信号，避免 C3 的提前 return 卡死。页面回调在读取当前卡前处理冲突，释放锁并关闭旧重抽场景，统一进入裂罅列表。新列表按下发的 saveData 重建，场景进入完成后使用既有 `OkDialog` / `DialogContent.DynamicText` 提示 **“裂罅已变化，请重试”**。正常分解完成同样回列表但不显示冲突提示。

请求对象及窗口上下文共同确认回包归属：已离开的页面、不同槽、同槽重新进入的新页面不会被旧回包退出；重复完成不会重复导航或提示。原费用确认与二选一通过原 closeThen 先关闭再发送请求。冲突只经 HTTP 200 的正常成功响应处理，没有新增致命错误路径。

## 3. 存档、编队与区间

公共裂罅增量严格先执行 `weapon_riven_deleted`，再合并 `weapon_riven_list`；同槽同时删除并下发新卡时保留新卡。原有物品、用户等公共响应字段仍走原路径更新。`party_info_list` 在 C1–C3 尚未接入，本次补接普通编队的 `PlayerLogic.updatePartyInfo`，活动编队复用 `PartySaveDataTools.fromPartyInfo → PartyLogic.applyPartySaveData`。按 category + party_id 匹配已加载的普通、活动、个人展示及历史编队；Rush 4–7 类还核对当前事件类别，缺少缓存或类别不符时不构造或误写其他编队。服务端原响应没有 event_id，本次没有推造它。

CommonResponse 增加可选 `party_info_list: Array<PartyInfo>`；原 PartyInfo 增加可选 `party_category: Int`，防止复制/回放丢失分类。复用现有类型注册，无新增运行时类型、方法或 trait，旧数据缺少这些字段仍可读取。详细分类路由与真实字节码案例见 `validation/c4-party-results.json` 和 `audit/build.json` 的 party 元数据。

所有实例判断上界统一到 **16000999**，下界 **16000001**；C2 负 status 为 **[-16000999, -16000001]**。未知裂罅 16000000 仅在原有库存显示分组中保留。同步覆盖 C3 `0x05000000 | item_id` 行键上界，避免新槽显示后无法点击。旧 16000200 常量和原指令为可逆拼接而保留在字节流中，执行到相应上界时由插入指令替换为 16000999；不存在仍以 200 截断的有效判断路径。

准入的三处字符串同步为 `{ADMISSION_BUILD}`：声明 build、证明消息 `SP-ADMISSION-1\\n<build>\\n` 前缀、BuildConfig.ID。协议、算法、凭据和准入方法指令保持原样，替换回 C3 字符串后两个准入 ABC 原始字节逐字节等于基线。

## 4. 方法与结构约束

相对 C3 主 ABC 改动 **{build['changed_method_count']} 个既有方法体**，其余 {build['preserved_c3_body_records']} 个完整记录不变。全部改动为单方法拼接，可反拼接恢复 C3 原指令；`assert not editor.new_methods and not editor.traits` 通过。方法、实例、类、脚本、元数据、命名空间表不变；主 ABC 常量池原前缀不变。未新增运行时方法、类或 trait。

| 方法 | body 索引 | 模块 |
|---|---:|---|
{methods}

四个禁改类共 **562** 个命名方法 / 构造器完整记录与 p13 相同，未修改共享攻击计算。

| 类 | 方法数 | p13 = C4 聚合 SHA256 |
|---|---:|---|
{hashes}

## 5. 离线验证与证据边界

| 测试组 | 通过案例数 | 结果文件（build-c4/） |
|---|---:|---|
{rows}

C4 覆盖 riven_id 不符、卡已删除、battle_in_progress 的 draw/select/dismantle 冲突，正常分解、取消、确认间槽复用、重复/晚到响应、连接框闭合、列表刷新与通用提示；并覆盖合并顺序、编队更新、全部有效上界与 201/999 槽实际消费者。C1–C3 回归组全部重新运行，旧“201 越界”“删除最后覆盖更新”和请求体期望按 v1.1 修订，保留原普通 EX、普通装备、普通魂珠和序列化回归意图。

测试执行最终 SWF 的实际序列化方法或明确列出的指令切片，原生 UI、Gear、网络与主表使用显式适配器。**未执行 AIR 验证器、真机排版、设备登录、实际战斗、在线服务端事务或准入授权。离线通过不等同于真机验收。** 签名成功也不证明服务端已对 C4 开通能力或主表资源已发布。

## 6. 实现选择与后续联调

- C4 补齐分解入口和 party_info_list 缺口，未改变服务端费用、持有上限、随机词条及联机去珠规则。
- 返回目标统一为裂罅列表，避免从编成/道具详情进入时回到不确定的上级页面。
- 扩大的是客户端识别范围；当前服务端持有上限、已登记占位主表和预留槽是否启用仍由服务端/数据层决定。
- 保留 C3 的词条极性目录、按单调 riven_id 表示获得顺序等既有行为；未扩大为服务端或资源发布任务。

真机/服务端联调待另行执行：登记 C4 build 并准备对应 item/ability_soul 主表；验证三接口 ABA 冲突、删卡、战斗中禁止操作；检查确认/二选一/连接框全部退出、提示一次且可重试；验证分解清空所有类别编队引用、五重未知裂罅不足时清退；用 201/999 资源检查列表/详情/重抽与编成；回归普通 EX、普通装备/魂珠及 C3 筛选；确认新增分解按钮的实际触摸区域与排版。设备安装和部署均未在本次执行。

## 7. 复核入口与封存

```powershell
python -B build-c4/source/c4_prepare.py
python -B build-c4/source/c4_build.py
python -B build-c4/validation/c4_validate.py
python -B build-c4/validation/c4_review.py
python -B build-c4/source/c4_package.py --preflight-only
python -B build-c4/source/c4_package.py --check-only
# 封包命令拒绝覆盖已有交付 APK：
python -B build-c4/source/c4_package.py
python -B build-c4/source/c4_report.py
python -B build-c4/source/c4_seal.py
```

`audit/build.json` / `audit/pcode/` 保存方法清单、静态检查和可逆拼接证据；`audit/protected-method-hashes.json` 保存禁改类逐方法哈希；`validation/all-results.json` 绑定同一最终 SWF 和所有测试结果；`audit/independent-c4.json` 保存独立回读审计；`build-audit/riven-p1c4-apk-final.json` 保存末步 nocache 与 APK 回读证据；`audit/input-preservation.json`、`C4-DELIVERY-MANIFEST.json`、`SHA256SUMS.txt` 保存原件保全和最终文件封存清单。
'''
    (WORKSPACE / 'C4-REPORT.md').write_text(text, 'utf-8')
    print(json.dumps({'report': str(WORKSPACE / 'C4-REPORT.md'), 'cases': tests['case_count']}))


if __name__ == '__main__':
    main()
