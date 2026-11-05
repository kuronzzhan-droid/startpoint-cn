# 四个扭蛋池的离线美术交付

本目录提供封面、横幅、人物页和原生主动技能演示的完整离线候选。所有资源保持非启用状态，未修改正式卡池、资源 manifest 或游戏代码。

| 目录 | 主题 | 展示角色数 | 完整页数 | 原生技能帧数 |
| --- | --- | ---: | ---: | ---: |
| [starview-encounter](starview-encounter/README.md) | 星见镇的奇遇 | 6 | 13 | 1462 |
| [autumn-beast-dice](autumn-beast-dice/README.md) | 秋夕祭月·兽夜博饼 | 3 | 7 | 656 |
| [autumn-prayer-rabbit](autumn-prayer-rabbit/README.md) | 秋夕祭月·祈穗灯兔 | 3 | 7 | 916 |
| [autumn-moon-laurel](autumn-moon-laurel/README.md) | 秋夕祭月·月轮桂灯 | 3 | 7 | 876 |

角色列表只是美术展示对象。正式入池角色、UP、券种、概率、保底、兑换和开放日期由维护者决定。人物页的限定牌保留模板美术，不构成入池或获取资格配置。

## 查看完整演出

在本目录运行以下命令（Node.js 22 或更高版本，无第三方依赖）：

```sh
node --max-old-space-size=192 build-preview.cjs starview-encounter starview-encounter/review.html
node --max-old-space-size=192 build-preview.cjs autumn-beast-dice autumn-beast-dice/review.html
node --max-old-space-size=192 build-preview.cjs autumn-prayer-rabbit autumn-prayer-rabbit/review.html
node --max-old-space-size=192 build-preview.cjs autumn-moon-laurel autumn-moon-laurel/review.html
```

生成的是可离线打开的自包含 HTML，内含全部封面、技能、人物页和播放控制。顺序为「封面 → 角色技能 → 角色人物页」，逐个角色循环。用支持 WebM 和 `DecompressionStream` 的浏览器打开；编辑器显示源码时，需要切换至浏览器或 HTML 预览。已有输出不会被覆盖。

`preview/` 保存可重建的数据、原生录制和播放器。为减少重复大文件，没有再提交完整拼接 MP4；HTML 已含完整演出。重建过程不启动 AIR、不重新录制、不下载资源。原生录制以 60 fps 回放；内嵌视频为 360×520，放大时细节会软化。界面文字及 Movie 图像是冻结预览的对应资源。

公开导出仅去除本机路径元信息及空白行多余空格，图像、帧序、播放器逻辑和原生视频保持不变。

## 原生文件与接入说明

- 每池 `native-assets.zip` 包含原生 Movie、timeline、atlas、PNG 和选池横幅；`native-resources.json` 给出逻辑路径、ZIP 成员、大小和 SHA-256。PNG 保留客户端的存储格式，不能用普通图片重存覆盖。
- `FEATURE-RECIPE.json` 给出美术与技能页的连接顺序，没有正式卡池配置。
- `scenes/RESOURCE-MANIFEST.json` 给出独立命名的 replay、terrain、裁切、原生录制身份以及五张场景表的行片段方案。`scenes/DONOR-ROWS.json` 保存本次录制实际使用的供体行，zone 的嵌套行保留原始字节。
- 合并场景时，先在当前有效资源链检查名称冲突，分配独立数字 quest ID，替换 `AUTHOR_QUEST_ID_*` 占位符，再按列顺序合并 gacha_skill_preview、skill_preview_quest、field_data、field、zone。`gacha_skill_preview` 中裁切列顺序是 **top、left**；录制说明中的 `clipLeftTop` 是 **left、top**。
- replay 和 terrain 的字节与选中原生录制输入一致。场景均有独立逻辑路径和独立行名，不覆盖官方供体。资源路径改名后的完整游戏运行仍待维护者接入验证。
- 月轮桂灯的米娅额外交付四个独立背景资源，保留原生背景上移 360 世界单位的修正。parts 与 atlas 只改内部图片引用到独立目录，已进行解码回读及逆向比对；PNG、timeline、轨迹、技能窗口和地形未因此改变。必须同时接入背景四件套及对应 field 行，不能只替换预览视频。
- 角色模型、技能 DSL、音效等既有依赖由目标客户端有效资源链提供。本包不交付完整客户端或整张角色主表，也不修改技能数值。若目标链角色版本不同，应先核对角色与技能依赖，再重新进行原生验证。

## 验证与已知边界

```sh
python3 verify.py
```

检查覆盖文件闭包、SHA-256、ZIP 成员、原生资源格式、五表连接、独立命名、角色和页序、录制完整窗口及四份 HTML 重建。检查按池串行运行，Node 堆上限 192 MiB；不解包整客户端、不批量读取原始帧。制作/接入时也应串行运行重处理任务，并在启动前设置进程内存与时限，避免多个录制或渲染任务竞争内存。

当前证据是离线原生录制、静态资源核对和冻结预览重建，不代表手机、目标客户端或资源链接入验收。外沿特效、文字在不同显示比例下的可读性，以及实际 UI 的遮挡仍需实机检查。各池补充说明见子目录。没有修改 accepted registry，也没有启用或上传资源增量。删除本目录及对应交付检查即可撤回，存档和正式卡池不受影响。
