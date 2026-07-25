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

| # | 块 | 内容 | 可独立成 PR |
|---|---|---|---|
| 1 | docs | 本文档 | — |
| 2 | content: id 派生表转换 | `item_ids.json`/`equipment_ids.json` 从 CDN 派生
    (投影 item/equipment 主表键集),邮件白名单读法迁移到 ContentRepository
    (消除 mail.ts 静态 import 的"新内容须重启"缺陷) | ✅ mod 中立 |
| 3 | content: rush quest 表转换 | `rush_event_quest.json`/`rush_event_quest_folder.json`
    从 CDN 转换,`lib/assets.ts` 读法迁移到 snapshot | ✅ mod 中立 |
| 4 | modes: 基座激活入口 | `src/modes/`:loader(modes.d/*.mjs + allowlist 哈希核对)
    + registry + quest 结算/进本两处 dispatch 调用点;`MODES_ENABLED` 总开关;
    无模式包时行为与基线逐字节一致 | 设计可议(编译期注册变体见文末) |
| 5 | modes: rogue 玩法包源码 | `modes-src/rogue/`(不参与基座构建),构建产物为
    独立 `rogue.mjs` 改造包;激活由 CDN 内容键控(激活表) | fork 私有 |

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
