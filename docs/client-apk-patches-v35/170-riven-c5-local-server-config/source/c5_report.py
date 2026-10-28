"""Generate the Chinese C5 delivery report from verified build/package receipts."""
import json
from bootstrap import ROOT, WORKSPACE, BASE_SHA, sha
from c5_config import APK, PACKAGE_REPORT, SWF, VERSION_CODE, ADMISSION_BUILD, OLD_ADDRESS


def read(relative):
    return json.loads((ROOT / relative).read_text('utf-8-sig'))


def location(row):
    refs = []
    for ref in row['references']:
        if ref['kind'] == 'static_trait':
            refs.append(ref['class'] + '.' + ref['name'])
        else:
            refs.append(f"{ref['label'] or '匿名闭包'}：body {ref['body']} / method {ref['method']} / 指令 {ref['instruction']}")
    return '<br>'.join(refs) or '无 pushstring / 静态字符串 trait 引用；遗留常量仍同步替换'


def main():
    build, tests = read('audit/build.json'), read('validation/all-results.json')
    package = json.loads(PACKAGE_REPORT.read_text('utf-8'))
    protected = read('audit/protected-method-hashes.json')
    independent = read('audit/independent-c5.json')
    assert all(row['status'].startswith('passed') for row in (build, tests, package, independent))
    assert build['sha256'] == tests['swf_sha256'] == package['swf_sha256']
    assert sha(APK.read_bytes()) == package['apk_sha256']
    addresses = [row for row in build['constant_edits'] if OLD_ADDRESS in row['old']]
    address_table = '\n'.join(
        f"| `{row['abc']}` | {row['string_index']} | `{row['old']}` | `{row['new']}` | {location(row)} |"
        for row in addresses)
    identity_table = '\n'.join(
        f"| `{row['abc']}` | {row['string_index']} | {location(row)} |"
        for row in build['constant_edits'] if row not in addresses)
    protected_table = '\n'.join(
        f"| `{name}` | {row['method_count']} | `{row['c5_sha256']}` |"
        for name, row in protected.items())
    suites = '\n'.join(f"| {name} | {row['case_count']} | `validation/{row['report']}` |"
                       for name, row in tests['suites'].items())
    text = f'''# 裂罅专用本地服 C5 客户端交付报告

日期：2026-10-26。任务依据：本目录 `C5-BRIEF.md`。基线为原封存 C4，SWF SHA256 `{BASE_SHA}`，APK versionCode 1008055。

## 交付结果

已在 `build-c5/` 完成本地构建、全部 **18 组 / 498 个 C4 离线案例**及 APK 封包。C4 原目录保留。未安装设备、部署服务端、推送 Git、调用付费 API 或 hearthbot 工具。本目录不是 Git 仓库，未初始化仓库或创建提交。

| 项目 | 最终值 |
|---|---|
| APK | `{APK}` |
| APK SHA256 | `{package['apk_sha256']}` |
| APK 字节数 | {APK.stat().st_size} |
| versionCode | **{VERSION_CODE}** |
| AIR uniqueappversionid | **`{package['receipt']['build_id']}`** |
| DEX BuildIdentity.ID | `{package['receipt']['build_id']}`，与 AIR UUID 相同 |
| 准入 build | **`{ADMISSION_BUILD}`** |
| HTTP / CDN 本地基址 | **`<SERVER_HOST>:18001`** |
| 联机目标 | **`<SERVER_HOST>:18003`**；客户端读取 API 的 `ip_address/port`，专用服务端须下发该值，未联网验证 |
| SWF | `{SWF}` |
| SWF SHA256 | `{build['sha256']}` |
| 包名 / 档位 | `com.leiting.wf` / local x86 档 |
| 实际 ABI | `arm64-v8a`、`x86_64`；逐字节继承 C4 双 ABI 原生库 |

## 地址出现位置与替换清单

在改动前生成 `audit/constant-inventory-before.json`，其中记录 ABC 字符串索引、原始 ABC / 解压 SWF 字节偏移及指令引用。扫描全部 SWF ABC 后，共发现 **9 条**含旧地址的常量，已全部替换。索引和方法指令不变；最终解压 SWF 内旧 `<SERVER_HOST>:8001` 出现次数为 0，新地址出现次数为 9。

| ABC | 字符串索引 | C4 原值 | C5 新值 | 引用位置 |
|---|---:|---|---|---|
{address_table}

CDN / patch 相关路径也已核查：没有另一个含旧主机的独立 CDN / patch 常量。`DevConfig/get_intermediateAssetServer`（body 91809）从同一 apiServer 生成 `/asset`；`AneAssetDownloading/startDownload`（body 28121）读取 `assetGetPathResponse.full/diff.archive` 下载列表；`AssetDownloader/getBaseUrl`（body 28256）读取 info 文件的 `baseUrl`。因此客户端固定基址已迁移，服务端响应及资源 info 中返回的绝对 URL 仍由专用服务端提供；本次没有联网核对这些返回值。

联机没有固定的 `:8003` 本地地址。`MultiBattleMeetUpScene/prepareRemoteInput`（body 63007）、`MultiBattleRoomSelectFlowBase/changeSceneRoomReady`（82795）、Lounge 路径（82894 / 82905）及 `MultiBattleRoomPrepareFlow/sceneChangeToRoom`（92034）从响应 `ip_address/port` 建立 SocketConfig；`SockletConnection` 构造器（31422）保存 host/port，`socketConnect`（31407）传给 XMLSocket.connect。客户端继续使用这条原路径，专用服务端须下发 **18003**；本次未改服务端配置、未声称已经连通。

主 ABC 的 `ints[532]=8001` 与 `ints[590]=8003` 是 `AssetMap`、`ViewAssetCache`、`ViewAssetContainer` 和 `ErrorCodeTest` 的错误码，并非端口，按“其他内容不变”要求保留。

## Java / DEX、启动缓存与资源检查

基线 `classes.dex` 为 16904 字节、255 条字符串，未发现本地 IP 或旧端口字符串；也未发现 8001 / 8003 / 18001 / 18003 的 DEX 整数常量字节序。Java 的 BuildIdentity / StartupCache 没有本地服务端硬编码，因此无需地址补丁。SWF 的 `cn/admission/BuildConfig` 已在上表单独处理，不能把它与 Java 配置混为一处。

只读审计检查了 APK 顶层成员及 97 个嵌套 JAR / ZIP 的 15758 个成员。原生库中的 `8003` 命中属于 clang 工具链版本串 `d8003a456...`；其他裸数字命中属于电话元数据或许可证文本。未将这些无关内容作为端口替换。详细哈希与证据见 `audit/address-audit.json` 和 `audit/address-audit.md`。封包前后还扫描所有非 SWF 成员中的旧完整本地端点（UTF-8 / UTF-16LE / UTF-16BE），均无命中。

DEX 的实际变化仅来自末步 nocache 更新 `cn/startpoint` 启动清理身份，原版脚本在 baksmali 回读后确认其余类逐文件一致。

## 准入身份与字节范围

三处准入身份统一为 `{ADMISSION_BUILD}`；证明前缀为 `SP-ADMISSION-1\\n{ADMISSION_BUILD}\\n`。协议、算法、凭据和所有准入方法指令保持 C4 原样。

| ABC | 字符串索引 | 用途 / 引用 |
|---|---:|---|
{identity_table}

相对 C4 共改 **12 个字符串常量**（9 个地址 + 3 个准入身份），只涉及 `boot_ffc6`、`cn/admission/ClientAdmission`、`cn/admission/BuildConfig` 三个 ABC。每个改动 ABC 反替换这些常量后恢复 C4 原始字节，其他 SWF 标签逐字节一致；独立复核还重建完整解压 SWF 与 C4 比较。长度字段和 CWS 压缩数据随字符串长度正常变化。

主 ABC 的 **{build['unchanged_main_body_records']} 个完整方法体记录全部不变**，方法、类、实例、脚本、元数据、命名空间及非字符串常量表不变，字符串索引和数量不变。构建执行 `assert not editor.new_methods and not editor.traits`；新增方法、trait 和方法拼接数量均为 0。

四个禁改类共 **562 个方法 / 构造器完整记录**与 p13 相同：

| 类 | 方法数 | p13 = C5 聚合 SHA256 |
|---|---:|---|
{protected_table}

## 离线回归与封包验证

| 测试组 | 通过案例数 | C5 结果文件 |
|---|---:|---|
{suites}

以上全部重新运行并绑定同一 C5 SWF SHA256，没有复用 C4 结果文件。另重跑生命周期 / 回调签名与 3 个循环上下文序列化复核，见 `validation/requests-independent-review.json`。验证副本只调整最终 SWF 路径、C5 身份与地址反替换预期；范围测试显式保留 C3 原始 200 上界作为历史 oracle，执行对象始终为 C5。源码差异与原 fixture 哈希见 `validation/validation-source-changes.json` 和 `validation/validation-source.diff`。

APK 最后修改步骤为原版哈希锁 `source/nocache/apk_nocache.py: refresh()`；此后只有回读验证。签名证书、zipalign、versionCode、AIR UUID、DEX 身份和内嵌 SWF 均通过。除签名成员外，相对 C4 仅 `AndroidManifest.xml`、`classes.dex`、`assets/worldflipper_android_release.swf` 改变；其余资源和 native 库逐字节保留。manifest / DEX 的版本与缓存身份更新是任务指定封包步骤的必需变化。

**证据边界：没有执行 AIR 验证器、设备安装或登录、在线准入、实际资源下载和联机。离线通过及签名成功不等于设备或服务端已验收。** 专用服务端需要提供 HTTP/CDN 18001、联机响应 18003，并登记 C5 build；这些服务端操作不在本次写入范围内。

## 复核入口和封存

```powershell
python -B build-c5/source/c5_prepare.py
python -B build-c5/source/c5_build.py
python -B build-c5/validation/c5_validate.py
python -B build-c5/validation/c5_requests_review.py
python -B build-c5/source/c5_review.py
python -B build-c5/source/c5_package.py --check-only
# 正式封包拒绝覆盖已有交付；末步内含 apk_nocache.refresh：
python -B build-c5/source/c5_package.py
python -B build-c5/source/c5_report.py
python -B build-c5/source/c5_seal.py
```

`audit/input-lock.json` 锁定 C4 全部原文件及任务输入；`audit/input-preservation.json` 在封存时核验原件无变化。`C5-DELIVERY-MANIFEST.json` 和 `SHA256SUMS.txt` 封存交付、源码、报告与验证证据；`build-audit/riven-p1c5-18001-apk-final.json` 保存 APK 末步封包及回读凭据。
'''
    (WORKSPACE / 'C5-REPORT.md').write_text(text, 'utf-8')
    print(json.dumps({'status': 'written', 'report': str(WORKSPACE / 'C5-REPORT.md')}))


if __name__ == '__main__':
    main()
