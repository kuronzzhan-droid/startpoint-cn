# 49 活动商品成员索引与最终快扫

按活动类型和 ID 建立商品成员索引，最终用前两字段快扫减少首次整表解码，并保留异常行原逻辑。

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v30-perf2 S1；v17 索引接入保留，productIds 方法最终由 S1 改写。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`ShopProductRepository/getAllProducts`；`ShopProductRepository/existsEventItemInQuestEvent`；`cn.shop.ShopFirstOpen/*`。
- 修的问题或错误码：未发现专用错误码；最终快扫降低兑换冷扫描，坏行仍回退并保留原 7050 语义。
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

此条已经包含 v30-perf2 S1 最终版，未将早期索引实现和后续快扫重复计为两个补丁；最终 helper 按方法从 v33 提取。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\shop-first-open\README.md:14-22`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`
- `D:\WF\perf-v30-20261015\tools\perf2_patches.py:28-123`
- `D:\WF\perf-v30-20261015\REPORT.md:307-385`
- `D:\WF\perf-v30-20261015\REPORT.md:458-480`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [ShopProductRepository/getAllProducts](pcode/boot_ffc6--ShopProductRepository_getAllProducts.pcode.txt)；body `25379`；code SHA-256 `d876a9c9842dd16661c24188b71c718219f74d316843d328e93273dad906ad2c`。
- [ShopProductRepository/existsEventItemInQuestEvent](pcode/boot_ffc6--ShopProductRepository_existsEventItemInQuestEvent.pcode.txt)；body `25381`；code SHA-256 `bc3956a4e87ea5c6878008d0ec2dde0524030064e5ba9062cb92a9090ccb63cb`。
- [ShopFirstOpen$/eventKey](pcode/cn.shop.ShopFirstOpen--ShopFirstOpen__eventKey.pcode.txt)；body `0`；code SHA-256 `060577dad26bcf7e5a1f295841a7fbda571b3f927b972001413df09af597a70b`。
- [ShopFirstOpen$/productIds](pcode/cn.shop.ShopFirstOpen--ShopFirstOpen__productIds.pcode.txt)；body `1`；code SHA-256 `a7bdffc161992fc7829e8b467685a35db8bc3c4d998c569c5eee56185e4d8b2a`。
- [ShopFirstOpen$/hasProductsOrBox](pcode/cn.shop.ShopFirstOpen--ShopFirstOpen__hasProductsOrBox.pcode.txt)；body `2`；code SHA-256 `8a3702c553e281fb673a5f8092b7ee1fd86bf434a426ed7ee9cdb6b6917ed354`。
- [ShopFirstOpen$/sideStoryExists](pcode/cn.shop.ShopFirstOpen--ShopFirstOpen__sideStoryExists.pcode.txt)；body `3`；code SHA-256 `69a0cb3068196578dfcd3289fbb9905fa1dab91285eb495a957c905a8cdf70da`。
- [ShopFirstOpen$/shopTopExists](pcode/cn.shop.ShopFirstOpen--ShopFirstOpen__shopTopExists.pcode.txt)；body `4`；code SHA-256 `8d9a436a9e936ed6ca8199570db0e44ab22c8605ddb668492353db1ea83cd1d8`。
- [ShopFirstOpen$/<cinit>](pcode/cn.shop.ShopFirstOpen--ShopFirstOpen___cinit_.pcode.txt)；body `5`；code SHA-256 `3f53edde9e8f5e3717157140d1de36723d14de92e557ccbaada2b93905f55f9f`。
- [ShopFirstOpen/<ctor>](pcode/cn.shop.ShopFirstOpen--ShopFirstOpen__ctor_.pcode.txt)；body `6`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.shop.ShopFirstOpen--anonymous-method-0.pcode.txt)；body `7`；code SHA-256 `7bbd992deb307d33a9aa565267e37d0031b92079e037272afd778d3ef176231f`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [patch_swf.py](source/patch_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\shop-first-open\patch_swf.py`；8,571 B；SHA-256 `dd1e959457b148d117d30f7a5ec3937cc928f7e0b7c0e8f70fc7462eb7a0dc47`。
- [perf2_patches.py](source/perf2_patches.py) ← `D:\WF\perf-v30-20261015\tools\perf2_patches.py`；14,850 B；SHA-256 `08c28cf3492d0c5c03ae87a51e0477e18a00438f4358d21ee08c87536841c224`。
- [perf2_apply.py](source/perf2_apply.py) ← `D:\WF\perf-v30-20261015\tools\perf2_apply.py`；1,900 B；SHA-256 `d000586e73c2c430b91e3efc8a3e1f6676ee20c02f36b95b78a3b689f88a6966`。
- [perf2_core.py](source/perf2_core.py) ← `D:\WF\perf-v30-20261015\tools\perf2_core.py`；9,504 B；SHA-256 `b5d50c6ae613e22773f8dd969df0faf80a3afe4a1aa1bef790b561ceb94c4a8a`。
- [build_perf2_apk.py](source/build_perf2_apk.py) ← `D:\WF\perf-v30-20261015\tools\build_perf2_apk.py`；6,583 B；SHA-256 `52f0ed20f5b74bddc3c3b76c6100525cbaa8751674dd12b8180db1754d48b862`。
