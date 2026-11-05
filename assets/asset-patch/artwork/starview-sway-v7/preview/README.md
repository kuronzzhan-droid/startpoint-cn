# 星见镇的摇曳 · 离线演出预览

本目录可重建 V7 单文件预览，包括群像封面、六段原生主动技能录制和六张双立绘海报。页面保留原界面、逐帧和半速控制。预览可离线播放。游戏内接入和设备验收另行处理。

## 生成

在本目录运行以下命令。脚本只使用 Node.js 内置模块，目标路径须为新文件。

```sh
node build.cjs ../starview-sway-preview.html
node build.cjs --verify
```

第一个命令生成可以直接打开的 HTML。第二个命令在内存中生成并核对冻结版本的 SHA-256。Node.js v24.19.0 的实测输出为 4,248,711 字节，SHA-256 为 `c6134297ac12a3743fb9ccdfdc62a82edb4f30b517cb03dff7cf086a7a7f14e8`。其他 Node.js 或 zlib 版本的压缩输出可能有差异。只有哈希一致的重建文件才能沿用对应 V7 的浏览器验收证据。

## 源文件

| 文件 | 内容 |
| --- | --- |
| `template.html` | 页面结构、样式和五个装配位置 |
| `preview-player.js` | Movie、扭蛋界面、页面顺序和播放控件 |
| `native-clip-player.js` | 内嵌技能录像的解码、定位与播放 |
| `review-data.json` | 七个 Movie 的结构化帧序列、界面、票券和嵌入图片 |
| `presentation.json` | 角色身份、海报与技能页面顺序 |
| `native-recordings.json` | 六个实际原生录像片段的帧窗、事件、哈希和 WebM 数据 |

六段技能共 1,852 帧，按原录制的 60 fps 和原生视口回放。十连券图标在预览中显示为「券」，接入时由作者换回正式图标。
