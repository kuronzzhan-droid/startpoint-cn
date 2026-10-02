# 副本攻略与推荐配队接口

本模块复用 Wiki 的管理员会话、同源验证、限流、D1 数据库和审计；不读写游戏存档。
可信副本 ID 来自 `dungeon-catalog.mjs`，页面入口图片、横幅和模式说明仍由静态资料目录提供。
测试可以通过 `createCommunityHandler(catalog, {dungeons})` 注入 `{items:[{id}]}`，也支持 `catalog.dungeons`。
目录中不存在的 ID 返回 404，不能通过写接口创建副本。

深渊、深渊 EX 和幻想的推荐配队可按层独立维护，原模式 ID 的通用攻略保留。
普通深渊 `event-rush-700099` 和 EX `event-rush-700100` 各支持 1–30 层及 `endless`；
幻想 `event-rush-700098` 支持 1–15 层及 `practice`。范围据 2026-09-30 灰服资料快照核对。
楼层攻略 ID 为 `<模式ID>-floor-<层号>`，例如 `event-rush-700100-floor-15`。
这只是 Wiki 攻略作用域，不是新增游戏关卡。可信模式必须仍在当前副本目录中，非法层号返回 404。
各层复用下述读写和图片接口，独立版本校验、权限、审计和引用验证，无需额外表迁移。
页面先显示通用攻略，点击哪一层才请求该层；切换层数保留当前页面已打开编辑器的未保存草稿。
配队从已有公开盘关联；修改原盘后各层引用随之更新，移除推荐不会删除原盘。

## 接口

路径均以 `/api/community` 开头。普通管理员、站长和副站长均可编辑共享攻略及公开队伍引用。
禁用账号、未完成首次改密或过期会话与现有管理功能保持一致。

| 路径 | 用途 |
| --- | --- |
| `GET /dungeons/:id` | 返回公共攻略及当前仍公开的推荐队伍 |
| `GET /admin/dungeons/:id` | 返回攻略、队伍以及当前管理员能查看的图片草稿 |
| `PATCH /admin/dungeons/:id` | 原子替换攻略正文、推荐队伍和图片，要求版本匹配 |
| `POST /admin/dungeons/:id/images` | 以原始二进制请求体上传图片，不使用 multipart/base64 |
| `GET /dungeon-images/:imageId` | 仅返回当前已被攻略引用的图片 |
| `GET /admin/dungeons/:id/images/:imageId` | 查看有权限的图片草稿或已发布图片 |
| `DELETE /admin/dungeons/:id/images/:imageId` | 上传者或站长、副站长删除未被引用的图片 |

攻略读取和保存返回：

```json
{
  "guide": {
    "id": "boss-example", "text": "攻略文字", "revision": 1,
    "teamIds": [], "imageIds": [], "images": [], "updatedAt": "2026-09-30T00:00:00.000Z"
  },
  "teams": []
}
```

未保存的攻略 `revision=0`、正文和数组为空、`updatedAt=null`。
管理读取和保存另带 `availableImages`，其中只包含本人草稿、已有引用图片；站长、副站长可查看全部草稿。
`teams` 复用现有公共队伍结构，包含 `gameCode`、点赞数和阵容，不包含管理员邮箱或私有字段。

保存请求为 `{expectedRevision,text,teamIds,imageIds}`，数组顺序就是展示顺序。
正文最多 30000 个 Unicode 字符；队伍最多 30 个，图片最多 12 张；引用不能重复。
正文是纯文本，前端必须以 `textContent` 等安全方式显示，不能当成 HTML。
仅攻略保存允许 128 KiB JSON，其余已有 JSON 接口仍限 16 KiB。
版本冲突返回 `409/edit_conflict`；失效或无权引用的队伍、图片返回 `409/references_unavailable`。

上传返回 `201 {image:{id,url,previewUrl,width,height,bytes}}`。
`url` 是公开图片路径，保存攻略引用前返回 404；`previewUrl` 是带权限的管理预览路径。
公共攻略中的图片不含 `previewUrl`。上传成功不等于已公开。

## 数据与边界

新增三张表：`community_dungeon_guides`、`community_dungeon_images`、`community_dungeon_audit`。
攻略按有序 JSON 数组保留引用；推荐队伍不复制原盘，关联移除不删除原盘、队伍码或点赞。
每次读取都从当前 `public + approved` 队伍生成预览；后来隐藏或改私密的盘不会继续泄漏。
保存时在 SQL 内再次检查引用权限，避免预检查与提交之间发生私密转换。
攻略修改、图片上传和删除均使用事务审计。图片删除在同一事务内检查无引用，避免破坏并发保存的攻略。

只接受 PNG、JPEG、WebP，校验 MIME 对应签名、文件结构边界、尺寸；拒绝 SVG、GIF、动画 PNG/WebP。
每图最多 512 KiB，单边最多 4096 像素，总像素最多 12582912。
服务端不执行图片解码或转码，前端应在上传前正常解码和缩小图片。
图片按 D1 BLOB 保存，响应固定实际 MIME，带 `nosniff`、同源资源策略和 `no-store`，撤下后不继续依赖缓存公开。
官方 D1 接口支持 ArrayBuffer 写 BLOB、数组读回：[D1 类型转换](https://developers.cloudflare.com/d1/worker-api/#type-conversion)。

存储配额：全站 256 MiB、每位上传者 64 MiB、每个副本 8 MiB；包括未被引用的草稿。
配额判断与插入为同一 SQL 写入，超限返回明确提示，需联系站长清理无用草稿。
上传按 IP 和管理员分别限制每小时 20 次；删除图片不能重置管理员上传次数。
所有管理写入继续适用原每 IP 每小时 120 次限制，包括删除。

## 迁移与验证

增量迁移为 `migrations/0007-dungeon-guides.sql`，只新增表和索引，可重复执行。
本地 SQLite 适配器从 `schema.sql` 自动补齐，不能用新空库替换正式库。
公网迁移和部署需按站点发布流程执行；本地测试不会自动配置或写入云端。

聚焦验证：

```powershell
node --test mod-tools/wiki-community/tests/dungeons.test.mjs mod-tools/wiki-community/tests/dungeon-images.test.mjs mod-tools/wiki-community/tests/dungeon-http.test.mjs
```

包括真实 loopback HTTP、迁移保留既有数据、会话权限、并发修改、私密引用竞争、图片发布/撤下/删除和大小配额。
