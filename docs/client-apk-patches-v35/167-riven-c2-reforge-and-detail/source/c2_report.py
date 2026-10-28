"""Write the Chinese C2 delivery report from verified final receipts."""
import json
from bootstrap import ROOT, WORKSPACE, BASE_SHA, FINAL, sha
from c2_config import VERSION_CODE, APK, PACKAGE_REPORT


def read(path):
    return json.loads(path.read_text('utf-8'))


def main():
    build = read(ROOT / 'audit/build.json')
    tests = read(ROOT / 'validation/all-results.json')
    package = read(PACKAGE_REPORT)
    protected = read(ROOT / 'audit/protected-method-hashes.json')
    assert build['status'] == tests['status'] == package['status'] == 'passed'
    assert build['sha256'] == tests['swf_sha256'] == package['swf_sha256'] == sha(FINAL.read_bytes())
    apk_sha = sha(APK.read_bytes())
    assert apk_sha == package['apk_sha256']
    identity = package['receipt']['build_id']
    methods = '\n'.join(f'| `{label}` | {row["body"]} | {", ".join(build["owners"][label])} |'
                        for label, row in build['changed'].items())
    hashes = '\n'.join(f'| `{name}` | {row["method_count"]} | `{row["c2_sha256"]}` |'
                       for name, row in protected.items())
    names = {'save': 'C1 存档与公共响应', 'dynamic': 'C1 动态能力、名称与详情',
             'typepacker': 'C1 存档／战斗快照 TypePacker', 'page': 'C2 页面与导航',
             'transaction': 'C2 交易状态机及普通 EX', 'presentation': 'C2 演出与确认逻辑',
             'presentation_ui': 'C2 三个 View.run', 'state_serialization': 'C2 状态／完成信号序列化'}
    suites = '\n'.join(f'| {names[name]} | {row["case_count"]} | `{row["report"]}` |'
                       for name, row in tests['suites'].items())
    content = f'''# 武器裂罅 P1 客户端 C2 交付报告

日期：2026-10-26。执行依据：本目录 `C2-BRIEF.md`、上级 `P1-CONTRACT.md` 第 4、5 节及指定调研／评审。

## 1. 交付结果与身份

**本地实现、离线验证和 local x86 档 APK 已完成。** 最终 SWF 的 {tests['case_count']} 个离线案例全部通过；没有安装设备、部署、修改服务端、推送 Git、调用付费 API 或 hearthbot。当前目录不属于 Git 仓库，因此没有初始化仓库或创建提交。C1 的 104 个输入文件逐个保全，构建链和证据均在独立 `build-c2/`。

| 项目 | 最终值 |
|---|---|
| APK | `{APK}` |
| APK SHA256 | `{apk_sha}` |
| APK 字节数 | {APK.stat().st_size} |
| versionCode | **{VERSION_CODE}** |
| AIR uniqueappversionid | **`{identity}`** |
| DEX BuildIdentity.ID | `{identity}` |
| SWF | `{FINAL}` |
| SWF SHA256 | `{build['sha256']}` |
| 基线 C1 SWF SHA256 | `{BASE_SHA}` |
| 包名／服务器档 | `com.leiting.wf` ／ local `<SERVER_HOST>:8001` |
| 实际 ABI | `arm64-v8a`、`x86_64`，继承 C1 的 x86 档双 ABI |

末个修改 APK 的步骤为复制并锁定哈希的 `build-c2/source/nocache/apk_nocache.py: refresh()`，之后只读取验证。签名、zipalign、manifest 版本、AIR UUID、DEX 身份、内嵌 SWF 回读均通过。除签名成员外，相对 C1 仅 `AndroidManifest.xml`、`classes.dex`、`assets/worldflipper_android_release.swf` 改变；其他资产及 native 库逐字节不变。DEX 回读确认 `cn/startpoint/` 以外的 smali 不变。

## 2. 页面流程的截图式说明（文字，非设备截图）

### A. 魂珠详情入口

```text
┌ <武器名>裂罅 ─────────────────────┐
│ 当前魂珠词条（C1 原详情内容）        │
│ 绑定武器：<武器名>                  │
│ 已重抽 N 次                        │
│       [重抽]        [关闭]         │
└──────────────────────────────────┘
```

仅已揭示且有 C1 存档记录的实例提供重抽入口。打开详情本身不设置全局裂罅模式；点击后使用现有回调绑定器进入 `SceneKind.Expod`，沿 `ExBoost` 第二参数传递上下文。取一个已持有的合法角色作为现有生命周期载体，不将魂珠 item_id 当作角色 ID。

### B. 裂罅重抽页

```text
┌ <武器名>裂罅 ─────────────────────┐
│               [绑定武器图]         │
│ 当前词条 · 已重抽 N 次             │
│ 词条 1                            │
│ 词条 2 … 最多词条 4               │
│ 下次费用：C 深渊币　余额：B         │
│                       [抽取按钮]   │
└──────────────────────────────────┘
```

标题精确为武器名＋“裂罅”，当前词条从第 0 行开始，不创建或显示 ExStatus 首行。每条词条用自身 `[key,L]` 和已有 `AbilitySoulAbilityLogic`／`MinToMaxLevelScale(L,1,100)` 生成描述。隐藏角色立绘、角色像素、切角色／强化按钮和页签；武器图通过已有 `ItemThumbnailView` 的资源加载与销毁链实现。每帧在时间轴更新后再次隐藏角色按钮，防止动画恢复可见性。角色满突破条件不参与裂罅抽取判定。

`next_cost` 来自当前 C1 实例记录，余额来自玩家持有的物品 `2370099`。700／1400／2800／3500 由服务端下发，客户端不自行增加费用；离线还验证了非表内下发值仍被一致采用。

### C. 费用确认与演出

确认框显示已重抽次数、将消耗的深渊币、持有量和扣除后的余额。开确认框和点击确认后各检查一次余额。确认后请求：

```text
weapon_riven/draw
{{item_id, revision}} + 既有 transport 的 viewer_id / api_count
```

即使是第一次付费重抽，也进入候选演出与二选一。收到公共响应后，C1 正规化并合并 `weapon_riven_list` 和 `item_list`；窗口读取最新 pending，播放 1–4 条词条的现有光束／时间轴动画。人物区域改为武器图，不播放固定 status。每个演出 DTO 自带模式标记，退出清理全局上下文后仍能正确退场。

### D. 左旧右新与保存

```text
┌ <武器名>裂罅 ─────────────────────┐
│ 原来的词条           新的词条      │
│ 旧 1–4 条            新 1–4 条     │
│ [保留新的]       [保留原来的]       │
└──────────────────────────────────┘
```

左右列表独立滚动。两个按钮分别提交：

```text
weapon_riven/select
{{item_id, draw_id, is_confirm:true/false}} + 既有 transport 的 viewer_id / api_count
```

响应继续沿 C1 公共合并路径更新 saveData，页面刷新当前词条、次数、费用和余额。保留旧词条也保留已经付费的重抽次数。选完后重复调用选择处理器因无 pending 不再发请求；重复成功回调只刷新当前状态。

### E. 恢复与返回

进入时若记录已有 pending，直接显示同一个旧／新选择框，不重新 draw、不扣币、不重复播放演出。返回通过原场景返回栈回到来源页，清理仅属于当前窗口的临时上下文；旧窗口不会清掉已属于新窗口的上下文。晚到的裂罅 Remote 回包在已退出或切换实例时不分发 UI 事件，也不进入普通 EX 解析器，公共存档合并仍由独立公共响应链处理。

## 3. 方法清单与禁止改动边界

相对 C1 共修改 **{build['changed_method_count']} 个现有方法**：页面／导航 24 个、交易与 Remote 12 个、演出／对话框 10 个。全部为可逆的单方法 P-code 拼接，移除插入后恢复 C1 原指令字节。保留其余 {build['preserved_c1_body_records']} 个完整方法体记录。

| 现有方法 | ABC body 索引 | 模块 |
|---|---:|---|
{methods}

`assert not editor.new_methods and not editor.traits` 通过。methods／instances／classes／scripts／metadata／namespaces／namespace sets 不变；常量池只追加所需字符串与非负整数，旧常量与所有 multiname 不变。主 `boot_ffc6` 之外的 SWF 内容逐字节不变。没有修改共享攻击计算，也没有修改 C1 的保存、战斗生产／消费或 TypePacker schema。

四个禁改类共 562 个命名方法／构造器的完整记录与 p13 一致。聚合哈希按 body 索引顺序拼接完整记录（含 header、code、exceptions、body traits）：

| 类 | 方法数 | p13 = C2 SHA256 |
|---|---:|---|
{hashes}

## 4. 离线验证与证据边界

全部结果绑定同一个最终 SWF：`{build['sha256']}`。共 **{tests['case_count']} 案例通过**。

| 验证组 | 案例数 | 结果文件（build-c2/validation/） |
|---|---:|---|
{suites}

交易测试覆盖 1–4 条候选 × 保留新旧、首次重抽、pending 恢复、两处余额不足、恢复后重试、四档费用与封顶、服务端费用权威、重复选择、晚到响应、公共响应延迟至事件消费前合并、普通 EX 首抽／重抽／保留新旧及原 Remote 成功解析。页面测试覆盖返回、上下文归属、完整详情回调至窗口 run、每帧角色控件隐藏、普通 EX 状态和普通魂珠入口。

状态序列化测试执行最终 SWF 中实际 TypePacker 注册／简化／具体化方法；使用严格验证且 `forceNullable=false`，证明普通 EX wire 与 C1 相同。裂罅 `SceneKind.Expod` 经过原 schema 往返后，执行实际 `ExBoostWindow.run` 从 C1 存档重建上下文，再实际执行离场清理；有／无 pending 都通过。draw/select 的内部完成信号也通过原 enum schema 往返。

执行对象是最终 SWF 的真实方法体／指令，不是只验证 Python 业务模型。C1 登录与公共解析巨型方法继续使用实际插入指令切片；C1 applyCommonResponse、能力插值、窗口状态函数、Remote 构造与成功函数、三个 View.run 和 TypePacker 相关实现执行完整方法。网络、原生容器／类绑定、Gear、UI节点、主表／纹理及本地化描述排版存在明确测试适配器。**没有执行 AIR 验证器、真实屏幕渲染、完整网络登录、实机战斗或在线服务端事务，不能把这些结果表述为真机验收。**

最终交叉复核见 `build-c2/audit/independent-c2.json`：复核者独立检查其他模块，其本人实现的交易部分明确标注为自审；主代理亦对跨模块边界复核。模块早期 candidate 结果保留为施工证据，不计入本节的最终 175 案例；汇总以 `all-results.json` 的 SWF 哈希为准。

## 5. 契约偏差与实现选择

1. **HTTP 契约未变。** 请求字段、币种、费用来源、pending、revision 和公共保存路径遵守 P1 契约；没有实现客户端随机抽词条。
2. **第二状态参数使用既有 EX 序列化形态承载内部标记。** 内存上下文仍为 `Some({{mode:"wfx_riven",item_id,record,…}})`。原 `CharacterExBoostInfo` schema 只保留 `status_id`／`ability_id_list`，因此内部写 `status_id=-item_id`、`ability_id_list=[]`；窗口仅在 `[-16000200,-16000001]` 范围恢复裂罅上下文，并重新读取 C1 权威记录。该负数不是主表 status，不实例化、不显示、不演出，也不发送到 HTTP。普通 0／正 status 和区间外负数不进入模式。采用此法避免扩大共享角色 EX／房间 schema。
3. **Remote 的既有 Hook 类型作为完成信号。** draw 发 `Finished(item_id,{{ability_id_list:[],status_id:0}})`，select 两个结果均发 `FinishedDiscard(item_id)`。窗口在裂罅分支只读取 C1 最新记录，不把信号当作角色 EX 结果。这些字段仅用于内部回放兼容，不改变“保留新的／原来的”的 HTTP `is_confirm`。
4. **确认框使用 null ExBoostLogic 载体。** 所有裂罅费用／文案解引用先分流；普通 EX 继续原主表模板。图标／演出 DTO 固定使用已有 5 星视觉，契约未定义词条独立稀有度；没有据此改变词条数值或概率。
5. **原方法有一处不可达末尾跳转。** `canChangeStateBySwipe` 追加不可达的 `pushfalse;returnvalue` 作为合法边界，满足严格静态检查；原字节可完整恢复。构建中不向 inherited writer 写入 Python 负整数，改用正数常量＋`negate_i`，且构建入口拒绝负整数池，vendor 原样保留。
6. **继承 C1 的准入身份限制。** AIR／DEX UUID 已更新，但 SWF 准入握手 build 仍为 `<ADMISSION_ID>`，不是本包独占身份。本次未改变准入协议或服务端配置；不能仅凭新 AIR UUID 宣称服务端已单独启用 `weapon-riven-v1`。
7. **x86 档保持 C1 双 ABI。** 实际包含 arm64-v8a／x86_64，没有制作 32 位 x86 专包或删改基线 native 库。

## 6. 真机／服务端联调验证步骤（本次未执行）

1. 服务端准备契约中的实例、词条主表及独立能力准入，先处理上节共享握手 build 身份问题。另行设备操作授权后安装本 APK，读回 versionCode `{VERSION_CODE}`、AIR UUID `{identity}` 和实际加载 SWF 哈希。
2. 使用至少两张不同绑定武器的实例及足够深渊币。打开详情确认“重抽”入口、动态名称和当前词条；普通魂珠没有该入口。检查长武器名、四条长文案、正负词条排版与武器资源加载。
3. 进入裂罅页核对无 ExStatus、无角色立绘／切人按钮／突破门槛；等待进场时间轴稳定后再次确认角色控件仍隐藏。返回应到原来源页。
4. 连续重抽，按服务端下发核对 700→1400→2800→3500→3500，次数与余额同步。分别保留新／旧，确认左旧右新、词条按各自 L 显示；拒绝候选也不退回已付费用或重抽次数。
5. 余额不足时尝试打开和确认；确认框打开后让余额改变，再确认不得错误发 draw。检查网络失败后原 processing 对话框可以关闭／重试，不残留额外锁。
6. draw 成功后断网／退出并重新登录，恢复 pending 直接二选一，币和次数不再次增加。select 回包丢失后重试，服务端返回当前状态且不会重复扣费；重新进入同卡、另一张卡都不串单。
7. 在没有裂罅上下文的普通角色 EX 上分别验证首抽直接结果框、重抽演出后二选一、保留新、保留旧、旧 pending 恢复、费用主表和原角色切换。特别检查普通 sealed ExAbility 在演出退场无 1069。
8. 核对 C1 单人冻结／恢复、武器匹配与联机去珠策略仍正常；本次只做相关离线回归，没有新增联机效果启用。

## 7. 构建与复核入口

```powershell
python -B build-c2/source/c2_build.py
python -B build-c2/validation/c2_validate.py
python -B build-c2/source/c2_package.py --preflight-only
python -B build-c2/source/c2_package.py --check-only
# 正式封装仅允许在尚无交付 APK 的新输出中运行；现脚本拒绝覆盖交付：
python -B build-c2/source/c2_package.py
python -B build-c2/source/c2_report.py
python -B build-c2/source/c2_seal.py
```

- `build-c2/audit/build.json`：方法清单、插入位置、静态检查、可逆性及源码哈希。
- `build-c2/audit/pcode/`：逐方法 C1／C2 指令对照。
- `build-c2/audit/protected-method-hashes.json`：四个禁改类逐方法哈希。
- `build-c2/audit/input-lock.json`、`input-preservation.json`：C1 输入前后保全。
- `build-c2/validation/all-results.json`：175 案例汇总及逐组报告哈希；同目录 `*-execution.log` 为执行记录。
- `build-c2/build-audit/riven-p1c2-apk-final.json`：签名包回读与唯一构建身份。
- `build-c2/C2-DELIVERY-MANIFEST.json`、`SHA256SUMS.txt`：最终封存清单。
'''
    (WORKSPACE / 'C2-REPORT.md').write_text(content, 'utf-8')
    print({'status': 'written', 'report': str(WORKSPACE / 'C2-REPORT.md'), 'offline_cases': tests['case_count']})


if __name__ == '__main__':
    main()
