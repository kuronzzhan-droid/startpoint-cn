# 第三方内容适配(fork/dev-base)

> 基线:dev@6ae68e4(2026-07-26 钉版)。本文档是本分支全部改动的理解锚点,
> 每个功能块独立 commit,可拆出单独 PR。

## 背景与实测依据

第三方(mod 作者)以"CDN 作者"身份产出内容链:形式合规(hex 命名/三层归档/
EntityLists/线性版本图)、经与本仓同语义的离线校验器审计。已实测(2026-07-26):

- 官方 tracked `catalog-cn-1.4.54.json` 金样在移植校验器下零偏差(677 归档/110 边/
  installedBytes 10,177,212,635);
- 一条真实第三方链(1.4.54→1.4.200,146 边)物化为合规视图后,本仓原生
  `npm run content:sync` **一次通过**:Release 构建并激活,阶段 A converter 正常
  转出第三方内容(character 510 行=官方 505+自制 5、gacha 584 行、含自制商店)。

即:内容编译管线对"形式合规的第三方输入"天然可用。本分支补齐的是其余环节。

## 改动地图(按 commit 顺序)

| # | commit | 内容 | 可独立成 PR |
|---|---|---|---|
| 1 | `63ea564` docs | 本文档 | — |
| 2 | `af678ec` feat(content) | `item_ids`/`equipment_ids` 从 CDN 主表键集派生;
    邮件白名单读法迁移到 ContentRepository(消除 mail.ts 静态 import 的
    "新内容须重启"缺陷) | ✅ mod 中立 |
| 3 | `598f91a` feat(content) | rush 三表(quest/folder/ranking)从嵌套 orderedmap
    转换,`lib/assets.ts`+rushEvent api 读法迁移到 snapshot;
    **官方 1.4.54 基线逐字节复刻通过** | ✅ mod 中立 |
| 4 | `d800be9` feat(modes) | `src/modes/`:loader(modes.d/*.mjs + allowlist 哈希
    双确认)+ registry + 结算/进本两处 dispatch;`MODES_ENABLED` 总开关;
    无模块时逐字节等同基线 | 设计可议(编译期注册变体见文末) |
| 5 | `7584040` feat(modes) | rogue 玩法包(`modes-src/rogue/`,不参与基座构建)+
    `custom-json` converter(模式配置表走 CDN)+ `equipment_max_level` 派生 | 前半 fork 私有,
    后半 mod 中立 |
| 6 | `a1ff46f` test(content) | registry 派生测试的期望更新 + 两张新表的 bundled 兜底 | 随 2/3/5 |

## 验证状态

- `npm run test:quick`:**失败集合与未改动的 6ae68e4 基线逐文件一致**(双方
  39 passed / 8 failed;剩余失败为 Windows 符号链接权限的既存环境问题);
- `tsc --noEmit` 干净;新增测试 18 项全通过(ids 6 / rush 3 / modes seam 4 / rogue 5);
- 真实第三方链 `content:sync` 端到端:1.4.200 Release 构建激活,cdn scope 覆盖
  item_ids 1300(官方 1284+自制)、equipment_ids 451、rush quest 131(官方 110+自制 21)、
  equipment_max_level 451(与既有手维护表零偏差)。

## 三产物分发模型

```
基座(本分支构建的服务端):只含激活入口,零玩法逻辑
玩法改造包(rogue.mjs+manifest):运营者手动放入 modes.d/ + allowlist 登记哈希 + 重启
内容包(CDN 增量):资源+激活表;激活 = 改造包已装 ∧ 快照激活表 enabled ∧ 能力握手通过
```

红线:内容包永不携带可自动加载的代码;安装改造包=运营者与安装服务端同级的信任决定。

## 设计边界

- 运行时外部模块(modes.d)与 Server Bundle verifier 的"清单外文件拒绝"方向存在张力,
  本分支以 allowlist(哈希登记)恢复审计性;若上游需要模式机制,编译期注册变体
  (去掉 loader,registry 静态导入)可直接平移,dispatch 调用点不变。
- 转换器均按阶段 A 方法论:官方 1.4.54 dump 复刻,与 bundled JSON 基线一致为验收;
  同步器不判断内容语义(与 content-sync.md 的责任分工一致)。
- 无热载:一切变更(内容/改造包)均经 sync+重启生效,不引入运行时可变性。

## 部署与验证(F5)

安装模式包:

```
cp modes-src/rogue/rogue.mjs modes.d/rogue.mjs
# 把 mode-manifest.json 的 sha256 登记进 modes.d/modes-allowlist.json
CDN_DIR=<cdn父目录> npm run content:sync && node --env-file=.env out/cn-server.js
```

启动日志应出现 `[modes] loaded rogue-rush (rogue-settlement@1) sha256=…`;
未安装模块或激活表缺失/disabled 时无此行,且行为与基线一致。

2026-07-26 服务端级验证(激活表经 CDN 1.4.201 边下发,配置由 custom-json 转换器
编译进 Release):

- 结算:700007 folder1 终轮 → 按 28 项池抽 2 发(首发保底武器),授予
  equipment 5020031 + item 5010057(同 id 的魂),reward list 正确回传;
- 防跳关:同一事件非终轮 → 返回 null,不进 rush_battle_reward_list;
- 惰性:未配置事件 id → 完全无副作用;
- CDN 下发:`res_ver 1.4.200` 的 get_path 正确返回 1.4.200→1.4.201 三层归档。

客户端真机验收(进本/掉落到账/轮次锁)仍需在实际客户端完成。
