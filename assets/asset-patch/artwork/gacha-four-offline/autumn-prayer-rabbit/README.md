# 秋夕祭月·祈穗灯兔

完整离线演出、美术原件和场景行片段；未接入游戏。

展示角色：稻穗（159991）、澄波响（169988）、蕾贝卡（169991）。名单不表示正式 UP。

采用 complete-07 对应的清晰姓名、称号及保留的限定牌。三个角色使用相同内容的局部地形候选，分别以独立逻辑路径交付。完整 HTML 的紧凑图像编码不替代原生 PNG；接入应使用 native-assets.zip 的原始资源。

![全界面总览](overview.jpg)

从上级目录生成完整 HTML：

```sh
node --max-old-space-size=192 build-preview.cjs autumn-prayer-rabbit autumn-prayer-rabbit/review.html
```

详见[公共交付说明](../README.md)的资源和五表接入方法。完整性记录见 [DELIVERY.json](../DELIVERY.json)。
