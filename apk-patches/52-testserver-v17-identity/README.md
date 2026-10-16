# 52 测试服独立包与准入身份

将作者累计包隔离为com.leiting.wt并同步更换标签、AIR身份和两份准入key

- 首发 APK 版本：**v17**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`AndroidManifest.xml`；`resources.arsc`；`cn.admission.ClientAdmission/*`；`cn.admission.BuildConfig/*`。
- 修的问题或错误码：准入key有两处编译副本，漏改会握手失败；生成源码不含实际key值
- 依赖：client-admission
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

## 最终采用证据

构建链及原始说明：

- `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3a2d10f4-784b-4e40-914d-69525c153b6e\scratchpad\apk\make_test_apk.py:1-19,59-98,125-148`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [ClientAdmission$/now](pcode/cn.admission.ClientAdmission--ClientAdmission__now.pcode.txt)；body `0`；code SHA-256 `97e276a3ed4c4fcccf2b212f6619f2e4f4395eea003ef18b5cc3f9a3c9d58df8`。
- [anonymous-method-3](pcode/cn.admission.ClientAdmission--anonymous-method-3.pcode.txt)；body `1`；code SHA-256 `204e6fe8400868d544fb7174a2eef145bf6eadec596da4df794a628ec54abfc5`。
- [anonymous-method-5](pcode/cn.admission.ClientAdmission--anonymous-method-5.pcode.txt)；body `2`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`。
- [anonymous-method-4](pcode/cn.admission.ClientAdmission--anonymous-method-4.pcode.txt)；body `3`；code SHA-256 `734c611a87932cbcc0c59e64b4e4e80f9b71836e975e2adc64c2b0868478e5b3`。
- [ClientAdmission$/state](pcode/cn.admission.ClientAdmission--ClientAdmission__state.pcode.txt)；body `4`；code SHA-256 `ec68b8009829286f1f9bdc695f8bafce6a5bd67bf11d243ccc9ab1f769818f77`。
- [ClientAdmission$/observe](pcode/cn.admission.ClientAdmission--ClientAdmission__observe.pcode.txt)；body `5`；code SHA-256 `625bb69a6ae976ddf2a25be4da89f606e7461b3cc92ca6ca7bc3a0cd36d23b26`。
- [ClientAdmission$/refreshSession](pcode/cn.admission.ClientAdmission--ClientAdmission__refreshSession.pcode.txt)；body `6`；code SHA-256 `e3229ea5ad3242195002b91605d8ca95609c338745d89a5a2fe4ba014274639d`。
- [ClientAdmission$/hold](pcode/cn.admission.ClientAdmission--ClientAdmission__hold.pcode.txt)；body `7`；code SHA-256 `4040161e4de3d334425aeb06f082dc7d0de7c6b7dfdab97392f63883eb2890ad`。
- [anonymous-method-10](pcode/cn.admission.ClientAdmission--anonymous-method-10.pcode.txt)；body `8`；code SHA-256 `1097b3d7d90c1d791d8c7feca61fb01e5a8b03f0a2e2b440cc8d489c6e9a9849`。
- [ClientAdmission$/failQueue](pcode/cn.admission.ClientAdmission--ClientAdmission__failQueue.pcode.txt)；body `9`；code SHA-256 `cb6a9cf05f3f396cd8040e7eda9e9d416eb4614af4126648e45c567f96ae82bd`。
- [anonymous-method-12](pcode/cn.admission.ClientAdmission--anonymous-method-12.pcode.txt)；body `10`；code SHA-256 `c4457758bebbe6c31cc233c87cdf2be9fe6b6336b7978e7fa57801a6e1ab2f07`。
- [ClientAdmission$/beforeQueue](pcode/cn.admission.ClientAdmission--ClientAdmission__beforeQueue.pcode.txt)；body `11`；code SHA-256 `8b0ffcd1ec5f48f50d1c5bbaeb34389e435adb2e2784643ee799dbf239b680ba`。
- [ClientAdmission$/queueCanceled](pcode/cn.admission.ClientAdmission--ClientAdmission__queueCanceled.pcode.txt)；body `12`；code SHA-256 `73c00264be42f8e06a4b59e4ace306826a569ceaa90f761decbe8644f3b15686`。
- [ClientAdmission$/attach](pcode/cn.admission.ClientAdmission--ClientAdmission__attach.pcode.txt)；body `13`；code SHA-256 `9990f6e9b864e9cfc9aaa24fe58033a46b121a59e30e3e9965c4b01a529eb273`。
- [anonymous-method-17](pcode/cn.admission.ClientAdmission--anonymous-method-17.pcode.txt)；body `14`；code SHA-256 `e7a2b7b56f85f2f362f04108193b378fcce556c63a23e87e5e1658a1622d7589`。
- [anonymous-method-16](pcode/cn.admission.ClientAdmission--anonymous-method-16.pcode.txt)；body `15`；code SHA-256 `79b15135679a0a3668a7cb632cb772c8d99e70d995c816d72c2ce80c6303ebf8`。
- [ClientAdmission$/beforeSocketConnect](pcode/cn.admission.ClientAdmission--ClientAdmission__beforeSocketConnect.pcode.txt)；body `16`；code SHA-256 `fba17aa746758d590f96197d1b6805b91dad7c6d74ec3af6bd0b71047f142e2a`。
- [ClientAdmission$/socketClosed](pcode/cn.admission.ClientAdmission--ClientAdmission__socketClosed.pcode.txt)；body `17`；code SHA-256 `a90a66d4c36102e4715300ab178262ed2d8a16c7c16ce6a264702a385d822b01`。
- [ClientAdmission$/socket](pcode/cn.admission.ClientAdmission--ClientAdmission__socket.pcode.txt)；body `18`；code SHA-256 `745c492994c401a9ada5850c6e01368081e1875b463c1732a8dcd6f46cdf7250`。
- [anonymous-method-21](pcode/cn.admission.ClientAdmission--anonymous-method-21.pcode.txt)；body `19`；code SHA-256 `24ab556fa66be165ff3c23f843e14881aecdfe6e25cfdf08a6ddcbcf34f5ab53`。
- [ClientAdmission$/inspect](pcode/cn.admission.ClientAdmission--ClientAdmission__inspect.pcode.txt)；body `20`；code SHA-256 `74ffc49d4fa2df67792dce63f054bc9ca8a0d90183dfcc4f217676037ef2e778`。
- [ClientAdmission$/forwardAdmission](pcode/cn.admission.ClientAdmission--ClientAdmission__forwardAdmission.pcode.txt)；body `21`；code SHA-256 `2e438fb4728cdda6cd095102159b2845f00cbea21b7cdd4ef2201a7149b27f33`。
- [ClientAdmission$/cancelLoad](pcode/cn.admission.ClientAdmission--ClientAdmission__cancelLoad.pcode.txt)；body `22`；code SHA-256 `1c78967f567b3419e35d719fcb4374d22d206c33a007dc83a637b7a40e18b7a3`。
- [anonymous-method-25](pcode/cn.admission.ClientAdmission--anonymous-method-25.pcode.txt)；body `23`；code SHA-256 `bdcc34080cbb66c7305a88091d42be4538542a51a04561466af9168f3c7f8b97`。
- [anonymous-method-26](pcode/cn.admission.ClientAdmission--anonymous-method-26.pcode.txt)；body `24`；code SHA-256 `8230620bee3081b3b611d822f717fa089590b3e9511ea8d38680064ffa6bcfb6`。
- [anonymous-method-28](pcode/cn.admission.ClientAdmission--anonymous-method-28.pcode.txt)；body `25`；code SHA-256 `951d3b4f366c50033780883d1ff6bafeb3788e1bbd62711a0ae6e2802d19b678`。
- [anonymous-method-27](pcode/cn.admission.ClientAdmission--anonymous-method-27.pcode.txt)；body `26`；code SHA-256 `6baf8e462ba41c179b27a07f1287bb7eacf1add34f90414dae8fee545f545f9d`。
- [anonymous-method-29](pcode/cn.admission.ClientAdmission--anonymous-method-29.pcode.txt)；body `27`；code SHA-256 `951d3b4f366c50033780883d1ff6bafeb3788e1bbd62711a0ae6e2802d19b678`。
- [ClientAdmission$/load](pcode/cn.admission.ClientAdmission--ClientAdmission__load.pcode.txt)；body `28`；code SHA-256 `8e98d09dc0c9a26faee11ee52b453b50b0ff8f6f3a2be21ffc419f6c3161be86`。
- [anonymous-method-31](pcode/cn.admission.ClientAdmission--anonymous-method-31.pcode.txt)；body `29`；code SHA-256 `b98010f3f8065a40a3dc203c1fba8d9fd7001365b6e2a116eb78aa2f8e36c2a4`。
- [ClientAdmission$/transport](pcode/cn.admission.ClientAdmission--ClientAdmission__transport.pcode.txt)；body `30`；code SHA-256 `7263a26a1637526c79986ceea8c0101fb31087ab29a27f76d7ec1ba9a4d3c422`。
- [anonymous-method-33](pcode/cn.admission.ClientAdmission--anonymous-method-33.pcode.txt)；body `31`；code SHA-256 `2c29176684a3c7eb585190e92927323e52959c75174b26397a57aaee78ff28a2`。
- [anonymous-method-34](pcode/cn.admission.ClientAdmission--anonymous-method-34.pcode.txt)；body `32`；code SHA-256 `8f52e784449ba13884bfdf07a18b8b6cb8c7a3d4d2f20bea65bb70055524adc8`。
- [anonymous-method-35](pcode/cn.admission.ClientAdmission--anonymous-method-35.pcode.txt)；body `33`；code SHA-256 `7193f08c0ba9ad156a157a0e33c7d07b6a4f5447e6cae8d1a0a8f3e00c327ba1`。
- [ClientAdmission$/sendAbsolute](pcode/cn.admission.ClientAdmission--ClientAdmission__sendAbsolute.pcode.txt)；body `34`；code SHA-256 `5b2c44179255fa8e12571fea2577ec5571d1931692f3057ebdc54b3bd49510d0`。
- [ClientAdmission$/hmac](pcode/cn.admission.ClientAdmission--ClientAdmission__hmac.pcode.txt)；body `35`；code SHA-256 `40fbb309abb2da2cef9bbc933c47f2ecf6c85d0f6d171d74a39c41aa12192ece`。
- [ClientAdmission$/sha](pcode/cn.admission.ClientAdmission--ClientAdmission__sha.pcode.txt)；body `36`；code SHA-256 `7af259c42ff5b9dbcf2ac92aa0a7dede800b3c715f65b4b0411266a7cc8ccf8a`。
- [anonymous-method-39](pcode/cn.admission.ClientAdmission--anonymous-method-39.pcode.txt)；body `37`；code SHA-256 `db5e9acbd42a04201faf2252c3fa3289e7f07ced4ac8f981eefb6586851064b8`。
- [ClientAdmission$/show](pcode/cn.admission.ClientAdmission--ClientAdmission__show.pcode.txt)；body `38`；code SHA-256 `bfc76919e096d193bfd884cc1be9c17f64583cbb5b2c4d7bda00f15f8e8877fb`。
- [ClientAdmission$/block](pcode/cn.admission.ClientAdmission--ClientAdmission__block.pcode.txt)；body `39`；code SHA-256 `35e0d6f62087471395c7644b3d82ba84806ee84d175bfb03ced61e1d1600239a`。
- [ClientAdmission$/raise](pcode/cn.admission.ClientAdmission--ClientAdmission__raise.pcode.txt)；body `40`；code SHA-256 `8802f50f4aa50e131dfc03dde2c7f1c49bf7031d9df50547771b53c8f034770e`。
- [ClientAdmission$/<cinit>](pcode/cn.admission.ClientAdmission--ClientAdmission___cinit_.pcode.txt)；body `41`；code SHA-256 `b113e3feae083e22979f60af0ec362c92b534e08fb9a245846943c4aa1746a7c`。
- [ClientAdmission/<ctor>](pcode/cn.admission.ClientAdmission--ClientAdmission__ctor_.pcode.txt)；body `42`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.admission.ClientAdmission--anonymous-method-0.pcode.txt)；body `43`；code SHA-256 `0c518f21f1ac3db375294c0697fd152da8181f234b3ec07d11905e4b178a0925`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [make_test_apk.py](source/make_test_apk.py) ← `C:\Users\12101\AppData\Local\Temp\claude\D--WF-startpoint-cn\3a2d10f4-784b-4e40-914d-69525c153b6e\scratchpad\apk\make_test_apk.py`；6,234 B；SHA-256 `8c1c835f0320cf0f9d224f2ea251d83d9c04780bdd62e43eb90fcb53c8a929b1`。

## 未收与限制

- BuildConfig 的实际生成配置含准入常量，不导出；保留生成脚本。
