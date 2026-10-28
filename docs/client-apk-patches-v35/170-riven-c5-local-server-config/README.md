# 170 — 武器裂罅 C5：裂罅专用本地服端口与准入常量配置（1008056）

## 作用

将本地测试包（`com.leiting.wf`）的 9 处 HTTP/CDN 基址常量切换至裂罅专用本地服端口，并更新本地准入 build 标识常量（注：后续合入测试服 `com.leiting.wt` `1008092` 时在 `port175` 中跳过本阶段，保留测试服地址与密钥）。

## 改了哪些类/方法

| 类 | 方法 | 改动 |
|---|---|---|
| `cn.admission.ClientAdmission` / 主 ABC 常量池 | 9 处 URL 与准入构建字符串常量 | C5 仅替换常量池字符串，不修改方法指令流 |

> 注：C5 仅替换 ABC 字符串常量池中的服务器地址与准入标识，无改动方法体，故 `pcode/` 为空。

## 开关或数据写法

- 仅修改 `ClientAdmission` 与主 ABC 中的 URL/准入构建常量（已按脱敏规则替换为 `<SERVER_HOST>` 与 `<ADMISSION_ID>`）

## 依赖的前置补丁

- `169-riven-c4-conflict-and-dismantle`

## 对应的数据边

- 武器裂罅数据边与服务端 `weapon_riven` 路由（`<WORKDIR>/outputs/work/weapon-riven-20261025`）

## 已知限制

- 采用单方法可逆指令插片（0 新增类、0 新增方法、0 新增 trait），依赖前置裂罅阶段锚点顺序叠放。

来源工作区：<WORKDIR>/outputs/work/weapon-riven-20261025/client-p1/build-c5
