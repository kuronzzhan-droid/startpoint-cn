# 22 空更新兼容与账号切换偏好保留

兼容旧服务端空更新响应并在账号切换时保留设备偏好

- 首发 APK 版本：**v17 以前；具体 APK 编号未核实**。
- v33 使用的最终修订：v17 已含且 v33 保留；具体修订编号未核实。
- 适用包：v33 与 v33-x86 共用客户端内容。
- 改动位置：`AssetGetPathRealRemote/successHandler`；`cn.asset.EmptyUpdate/*`；`cn.account.PlayerLogin/*`。
- 修的问题或错误码：未发现专用错误码
- 依赖：未发现额外功能依赖；仍需相同基线与构建工具。
- 是否只能以二进制形式发：否；已收可读补丁源/生成脚本或最终逐方法 P-code；二进制一律未收。

该AS路径在early_history原列表遗漏，可补收。

## 最终采用证据

构建链及原始说明：

- `D:\WF\startpoint-cn-kulo\client-patch\startup-cache\README.md:1-50`
- `D:\WF\apkp1016\research\early_actual_checks.json:method_checks/helper_checks/helper_callsites（本次实读v17/v33）`

本次只读核验以最终 v33 APK 哈希 `3de625cf0c745c79d333a09140ad82fdea74746d2e2200a5b6922f67eca14532` 与 SWF 哈希 `3b7b3391ae0aee01f15167fe1d5a5b69eddb71a64605c57486f025916611aaa4` 为锚；v33-x86 的 SWF 与它完全相同。此次未运行游戏，也未重新构建。

## 最终 P-code

以下是最终方法片段。若一个方法同时承载其它已收补丁，这里显示其 v33 合成后的状态；不能脱离对应生成脚本和基线逐个整方法覆盖。

- [AssetGetPathRealRemote/successHandler](pcode/boot_ffc6--AssetGetPathRealRemote_successHandler.pcode.txt)；body `47777`；code SHA-256 `1b4ba31b15628d5eab11d6b6f535327277d2d8e507f564da8153871e17bbeb28`。
- [EmptyUpdate$/normalize](pcode/cn.asset.EmptyUpdate--EmptyUpdate__normalize.pcode.txt)；body `0`；code SHA-256 `d63a38e092207419f21092ef1fd670c1fa68e36444525f7b2393d1fcf5116a1e`。
- [EmptyUpdate$/empty](pcode/cn.asset.EmptyUpdate--EmptyUpdate__empty.pcode.txt)；body `1`；code SHA-256 `a5ba2f7ce1c194aa907d67f12d5c645ed33f35b557f370ab225e5755db216c14`。
- [EmptyUpdate$/<cinit>](pcode/cn.asset.EmptyUpdate--EmptyUpdate___cinit_.pcode.txt)；body `2`；code SHA-256 `333e0a1e27815d0ceee55c473fe3dc93d56c63e3bee2b3b4aee8eed6d70191a3`。
- [EmptyUpdate/<ctor>](pcode/cn.asset.EmptyUpdate--EmptyUpdate__ctor_.pcode.txt)；body `3`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.asset.EmptyUpdate--anonymous-method-0.pcode.txt)；body `4`；code SHA-256 `d0dce5d8c73a9148a052376abb9845c39f0347fcba75264049e27b270ded94e1`。
- [anonymous-method-2](pcode/cn.account.PlayerLogin--anonymous-method-2.pcode.txt)；body `0`；code SHA-256 `bd6a7565cfed4142fc5b0a699b31d018c8ccacf19c2bc4f3a19fb28cfb722e0f`。
- [anonymous-method-3](pcode/cn.account.PlayerLogin--anonymous-method-3.pcode.txt)；body `1`；code SHA-256 `4ff73de7e1851205d648dc81bb4d16c19fba4719b0e63908fc434fcbbc34cca0`。
- [PlayerLogin$/title](pcode/cn.account.PlayerLogin--PlayerLogin__title.pcode.txt)；body `2`；code SHA-256 `803bf50e692ea1f93a972c08760f8649e0668bfe4751d00f0968552db63f6eb4`。
- [PlayerLogin$/readStoredRecord](pcode/cn.account.PlayerLogin--PlayerLogin__readStoredRecord.pcode.txt)；body `3`；code SHA-256 `3011006461044d70b121708baec9a4363beafabd85bd5e3596a7ace6d0b39aa4`。
- [PlayerLogin$/start](pcode/cn.account.PlayerLogin--PlayerLogin__start.pcode.txt)；body `4`；code SHA-256 `8cf30674fac365ca39f39a63ffd1e84888a17dbd98b88bd3562ab380136bfde1`。
- [PlayerLogin$/attach](pcode/cn.account.PlayerLogin--PlayerLogin__attach.pcode.txt)；body `5`；code SHA-256 `29fafac5c6c566d51efd5c4a1a9f62982314a984292efe77fa5b17a1723e4c9b`。
- [PlayerLogin$/socket](pcode/cn.account.PlayerLogin--PlayerLogin__socket.pcode.txt)；body `6`；code SHA-256 `9607b48cf6a34d9143e33f421e7638ce221a32badb7d518f6ccb9d6d012f4df5`。
- [PlayerLogin$/dispose](pcode/cn.account.PlayerLogin--PlayerLogin__dispose.pcode.txt)；body `7`；code SHA-256 `b688df737b5709ff041b4a2ccc81d5f4d515a98196b2ecf460342536ba6d690f`。
- [anonymous-method-10](pcode/cn.account.PlayerLogin--anonymous-method-10.pcode.txt)；body `8`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`。
- [anonymous-method-11](pcode/cn.account.PlayerLogin--anonymous-method-11.pcode.txt)；body `9`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`。
- [anonymous-method-12](pcode/cn.account.PlayerLogin--anonymous-method-12.pcode.txt)；body `10`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`。
- [anonymous-method-13](pcode/cn.account.PlayerLogin--anonymous-method-13.pcode.txt)；body `11`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`。
- [anonymous-method-14](pcode/cn.account.PlayerLogin--anonymous-method-14.pcode.txt)；body `12`；code SHA-256 `e8697f8915c88ef997c15784adaae0cc0240716b506143abb8d935fa010c9f10`。
- [PlayerLogin$/show](pcode/cn.account.PlayerLogin--PlayerLogin__show.pcode.txt)；body `13`；code SHA-256 `fb190df232e18a890598a6538a36990016b5f8ceed4260a443e60fdf1a077584`。
- [PlayerLogin$/detachBackGuard](pcode/cn.account.PlayerLogin--PlayerLogin__detachBackGuard.pcode.txt)；body `14`；code SHA-256 `ef6630e6c1a3cc740802234dcff735068d6b0b603d533dc5b72b822a36753a78`。
- [PlayerLogin$/guardBack](pcode/cn.account.PlayerLogin--PlayerLogin__guardBack.pcode.txt)；body `15`；code SHA-256 `918432dfc55d64b14363b02889d361bdc2ce2c065c725f15fc924d2a8eb62998`。
- [PlayerLogin$/clearLiveSession](pcode/cn.account.PlayerLogin--PlayerLogin__clearLiveSession.pcode.txt)；body `16`；code SHA-256 `1b62491b67aef18ed65f966970f2ace7214678f574a5cff5d3cf9af845228868`。
- [PlayerLogin$/findEntry](pcode/cn.account.PlayerLogin--PlayerLogin__findEntry.pcode.txt)；body `17`；code SHA-256 `c46784a6f1de8d73f578d00ab814dca465678db93d0b6d2405bb6a6287936212`。
- [PlayerLogin$/loadAccounts](pcode/cn.account.PlayerLogin--PlayerLogin__loadAccounts.pcode.txt)；body `18`；code SHA-256 `27019d04bf6d591bd53ee9ca2e6fecb4c4632bf509b1f528127801fc4e1f8002`。
- [PlayerLogin$/persistAccounts](pcode/cn.account.PlayerLogin--PlayerLogin__persistAccounts.pcode.txt)；body `19`；code SHA-256 `90399b76f7d0fa1593b054123860151537c08513191813cd409d87c29cc68454`。
- [PlayerLogin$/storageStatus](pcode/cn.account.PlayerLogin--PlayerLogin__storageStatus.pcode.txt)；body `20`；code SHA-256 `061341abe1b924cb7bd3bb8bba59949a4eb0d323bf723942795c71e0e55691c7`。
- [anonymous-method-23](pcode/cn.account.PlayerLogin--anonymous-method-23.pcode.txt)；body `21`；code SHA-256 `81e34c90a350c6a43354af20f5d245dddc1d266d0a8c6fb7771f346ef4031569`。
- [PlayerLogin$/resumeEntry](pcode/cn.account.PlayerLogin--PlayerLogin__resumeEntry.pcode.txt)；body `22`；code SHA-256 `785dcd6ff95295a35dfed3a795f6ebdc646f987fddd0a1579fcb70ffde5f1ff5`。
- [PlayerLogin$/invalidateEntry](pcode/cn.account.PlayerLogin--PlayerLogin__invalidateEntry.pcode.txt)；body `23`；code SHA-256 `6bcb6523745137640ba59a9fda2d7bbfe319e8aa6f999bca339c82d8da792c6f`。
- [PlayerLogin$/accept](pcode/cn.account.PlayerLogin--PlayerLogin__accept.pcode.txt)；body `24`；code SHA-256 `d5ba21746d0e2d10e448f4b85a463160f6c261709e7226fa9334987197b0f518`。
- [PlayerLogin$/switchAccount](pcode/cn.account.PlayerLogin--PlayerLogin__switchAccount.pcode.txt)；body `25`；code SHA-256 `ea8ac8549f7c4239f0d0c76685861ca5357ff110ef05d53d35993d3161fe1002`。
- [PlayerLogin$/removeEntry](pcode/cn.account.PlayerLogin--PlayerLogin__removeEntry.pcode.txt)；body `26`；code SHA-256 `c0faa766888c21206bd9df439383a076309e52840aed20c00979f57997f6ac86`。
- [PlayerLogin$/continueGame](pcode/cn.account.PlayerLogin--PlayerLogin__continueGame.pcode.txt)；body `27`；code SHA-256 `b68897a92a08bd3adee9708b7c3a4a6e3a31cd2459559917f144638219f87d1e`。
- [PlayerLogin$/navigate](pcode/cn.account.PlayerLogin--PlayerLogin__navigate.pcode.txt)；body `28`；code SHA-256 `9ddc02859d364a94ac9ae624f6217b833aa3005c94f4f5d9c565904d7c1c870c`。
- [anonymous-method-31](pcode/cn.account.PlayerLogin--anonymous-method-31.pcode.txt)；body `29`；code SHA-256 `7fecea38dd3896bf87e351c0f03212063b0ed353d273a2195a0aab61d2b2f8c2`。
- [anonymous-method-32](pcode/cn.account.PlayerLogin--anonymous-method-32.pcode.txt)；body `30`；code SHA-256 `8d9076abf1c292288254240faf1e45b57c12d1877eff5ad2b02d8e174b556651`。
- [PlayerLogin$/detectLocalSave](pcode/cn.account.PlayerLogin--PlayerLogin__detectLocalSave.pcode.txt)；body `31`；code SHA-256 `fd580e57b0855836ac6df4f9870e03c9ba86454c92a4fe114be61e3930e6e447`。
- [anonymous-method-34](pcode/cn.account.PlayerLogin--anonymous-method-34.pcode.txt)；body `32`；code SHA-256 `97aa21983897fc990c30c4a69395436a7cba733bc0147e26cd774d14a90edf13`。
- [anonymous-method-35](pcode/cn.account.PlayerLogin--anonymous-method-35.pcode.txt)；body `33`；code SHA-256 `45644a0b3482a3000188042a7f43468db9acadec94be747ff3526d0d4cdb5b5c`。
- [anonymous-method-36](pcode/cn.account.PlayerLogin--anonymous-method-36.pcode.txt)；body `34`；code SHA-256 `ee8b4daf99e9d1a96b24f4a1f4df38e74a55bd7560086f1e5f5f9dd04d6754bf`。
- [anonymous-method-37](pcode/cn.account.PlayerLogin--anonymous-method-37.pcode.txt)；body `35`；code SHA-256 `3abbfe05707156b6d1d4bd902f16b6e5f9a10836b973f00e4d57a7e6197925e0`。
- [anonymous-method-38](pcode/cn.account.PlayerLogin--anonymous-method-38.pcode.txt)；body `36`；code SHA-256 `610e0b45ac711297858b377ca2756302784234c86f82053ebba810e5e0f5c2d5`。
- [PlayerLogin$/request](pcode/cn.account.PlayerLogin--PlayerLogin__request.pcode.txt)；body `37`；code SHA-256 `5a89ee133b9ea7f4d97cdfe39d09675480b32d021110e9a58ef45a433b28c315`。
- [PlayerLogin$/cancelNetwork](pcode/cn.account.PlayerLogin--PlayerLogin__cancelNetwork.pcode.txt)；body `38`；code SHA-256 `ea7bb63812fc4e12a85994b9e8077f753173637f8fce9915d1ab3abca74e04cc`。
- [anonymous-method-41](pcode/cn.account.PlayerLogin--anonymous-method-41.pcode.txt)；body `39`；code SHA-256 `e85edae24999d4281d6c29833b707d87a87faa5765e71a9795c9b2410bad9785`。
- [anonymous-method-42](pcode/cn.account.PlayerLogin--anonymous-method-42.pcode.txt)；body `40`；code SHA-256 `d77582a5e73db9aaee5c985b62abe0bd5e2b0cb6301619fb2a5b635e04242b43`。
- [PlayerLogin$/submit](pcode/cn.account.PlayerLogin--PlayerLogin__submit.pcode.txt)；body `41`；code SHA-256 `9f4fc36de1908a5a032e7535817bb615213f7b38269395be3c54a0d7a9d7ffc4`。
- [anonymous-method-44](pcode/cn.account.PlayerLogin--anonymous-method-44.pcode.txt)；body `42`；code SHA-256 `063e2902f6f7ff0dcbc5f73892cc9316968b6f50f39e24dbc80bcec3cb853acc`。
- [anonymous-method-45](pcode/cn.account.PlayerLogin--anonymous-method-45.pcode.txt)；body `43`；code SHA-256 `0d0eced91e1e96790ed0aed5cd51afc8ae43a24497af0a48552a6b87b4f3153f`。
- [anonymous-method-46](pcode/cn.account.PlayerLogin--anonymous-method-46.pcode.txt)；body `44`；code SHA-256 `063e2902f6f7ff0dcbc5f73892cc9316968b6f50f39e24dbc80bcec3cb853acc`。
- [anonymous-method-47](pcode/cn.account.PlayerLogin--anonymous-method-47.pcode.txt)；body `45`；code SHA-256 `216e5ddc4034c8bb8d3063d58c54220b8ed2c6343f5a6a2e0555606d45da3dbc`。
- [anonymous-method-48](pcode/cn.account.PlayerLogin--anonymous-method-48.pcode.txt)；body `46`；code SHA-256 `575f08740cfa89112e68efa5872ae18e76b67c796f8e298340709c36aeb96ed0`。
- [anonymous-method-49](pcode/cn.account.PlayerLogin--anonymous-method-49.pcode.txt)；body `47`；code SHA-256 `f908ec72ff40a13cdf6d873c6a54564c919b56b8c3e2616d87aa38d6fe3215d7`。
- [anonymous-method-50](pcode/cn.account.PlayerLogin--anonymous-method-50.pcode.txt)；body `48`；code SHA-256 `8da3fa085fe7c5e9bbc511925d3365e3d74ef4ea64b2ea149e6b23c7716f6009`。
- [anonymous-method-51](pcode/cn.account.PlayerLogin--anonymous-method-51.pcode.txt)；body `49`；code SHA-256 `b45d878e8649a852e9286daa5142951e70eb016a83b5ff577da8a613e5f2bff2`。
- [anonymous-method-52](pcode/cn.account.PlayerLogin--anonymous-method-52.pcode.txt)；body `50`；code SHA-256 `9bf13cf33328f7a01e3a811a97782463228dcbf2f187dda63bdcb0c2728fb09e`。
- [anonymous-method-53](pcode/cn.account.PlayerLogin--anonymous-method-53.pcode.txt)；body `51`；code SHA-256 `051f279231f1009b4bf9a2a63a75f5921c2f671db98879ced2a37f0ffd665d61`。
- [anonymous-method-54](pcode/cn.account.PlayerLogin--anonymous-method-54.pcode.txt)；body `52`；code SHA-256 `a010875f9cd0c61f307b83476eb6985ed95776a0091b1c87e261a61b462e172d`。
- [anonymous-method-55](pcode/cn.account.PlayerLogin--anonymous-method-55.pcode.txt)；body `53`；code SHA-256 `7390cfcd0761681db5df96bd733889a32352e7eadc4a15e32715ce3f307c7783`。
- [anonymous-method-56](pcode/cn.account.PlayerLogin--anonymous-method-56.pcode.txt)；body `54`；code SHA-256 `193335d671cb1d17fb3582038efc4bde269da02417ed22318099b1c66dd2e31c`。
- [anonymous-method-57](pcode/cn.account.PlayerLogin--anonymous-method-57.pcode.txt)；body `55`；code SHA-256 `c7835be95ad5b21a3790acb5c2ac873847276217388b960cfce37bacca61fa88`。
- [anonymous-method-58](pcode/cn.account.PlayerLogin--anonymous-method-58.pcode.txt)；body `56`；code SHA-256 `8fedea4ecce7bfef0d2c264b49a95b105e421d7ae2c2a6bb30e6a775e4d946ce`。
- [anonymous-method-59](pcode/cn.account.PlayerLogin--anonymous-method-59.pcode.txt)；body `57`；code SHA-256 `3fb57d7fbdef07fc874e9833703993c800e985a69dbd15c9b14d2302d504ee2b`。
- [anonymous-method-60](pcode/cn.account.PlayerLogin--anonymous-method-60.pcode.txt)；body `58`；code SHA-256 `998289aededc12e1e29a4da2c00bf0d0d6a8f77f40195ad65b7ec5fb11f3c2c6`。
- [anonymous-method-61](pcode/cn.account.PlayerLogin--anonymous-method-61.pcode.txt)；body `59`；code SHA-256 `8fedea4ecce7bfef0d2c264b49a95b105e421d7ae2c2a6bb30e6a775e4d946ce`。
- [anonymous-method-62](pcode/cn.account.PlayerLogin--anonymous-method-62.pcode.txt)；body `60`；code SHA-256 `998289aededc12e1e29a4da2c00bf0d0d6a8f77f40195ad65b7ec5fb11f3c2c6`。
- [anonymous-method-63](pcode/cn.account.PlayerLogin--anonymous-method-63.pcode.txt)；body `61`；code SHA-256 `998289aededc12e1e29a4da2c00bf0d0d6a8f77f40195ad65b7ec5fb11f3c2c6`。
- [anonymous-method-64](pcode/cn.account.PlayerLogin--anonymous-method-64.pcode.txt)；body `62`；code SHA-256 `240d4eefbbb3c79029e1fd538a59b603947a6603f6e6f98193e45dde300a6da7`。
- [anonymous-method-65](pcode/cn.account.PlayerLogin--anonymous-method-65.pcode.txt)；body `63`；code SHA-256 `204f1c83e5e6efceb4a910b80e79eb6d454d2817d3d67e1476551c8bbb719123`。
- [PlayerLogin$/render](pcode/cn.account.PlayerLogin--PlayerLogin__render.pcode.txt)；body `64`；code SHA-256 `8c5b13b79a33ec3ca51ae28695bdca9dc90f22e29c8f1e9444fbd7bf1bb40d9a`。
- [PlayerLogin$/expiryLabel](pcode/cn.account.PlayerLogin--PlayerLogin__expiryLabel.pcode.txt)；body `65`；code SHA-256 `00bab8214b964c4d66f81c2506ef7b7355739dceb9fa55500db7087ad2fc916e`。
- [PlayerLogin$/wrappedLabel](pcode/cn.account.PlayerLogin--PlayerLogin__wrappedLabel.pcode.txt)；body `66`；code SHA-256 `ccb0c76428177e31d51333a53c45fe7b41e07bccd83c2dd63bea66c066276e52`。
- [anonymous-method-69](pcode/cn.account.PlayerLogin--anonymous-method-69.pcode.txt)；body `67`；code SHA-256 `871e799be5250427914150faffdeeeb84fb5294430e01a1c6aa50079478f6620`。
- [anonymous-method-70](pcode/cn.account.PlayerLogin--anonymous-method-70.pcode.txt)；body `68`；code SHA-256 `eb40bef7a0aea2f69bd09fa75ecdc8c80e8e88269f2525c7c2cf87c446144d2d`。
- [PlayerLogin$/accountRow](pcode/cn.account.PlayerLogin--PlayerLogin__accountRow.pcode.txt)；body `69`；code SHA-256 `4dbd55b18cc9e9b4caf0e38954d97db01cabec3a0d50ad50828b3f5d50baafbd`。
- [PlayerLogin$/resize](pcode/cn.account.PlayerLogin--PlayerLogin__resize.pcode.txt)；body `70`；code SHA-256 `5ad84a0574cad13f67ca23215ba62f4f4c0f472b945b48f55e551a47aa3ef4da`。
- [anonymous-method-73](pcode/cn.account.PlayerLogin--anonymous-method-73.pcode.txt)；body `71`；code SHA-256 `204f1c83e5e6efceb4a910b80e79eb6d454d2817d3d67e1476551c8bbb719123`。
- [anonymous-method-74](pcode/cn.account.PlayerLogin--anonymous-method-74.pcode.txt)；body `72`；code SHA-256 `0197753d0e9812b3f45bcb8f999a18ce4b1d339812f5ea145bd96cefe7724c3d`。
- [PlayerLogin$/tabs](pcode/cn.account.PlayerLogin--PlayerLogin__tabs.pcode.txt)；body `73`；code SHA-256 `4068318d6e65a9465852904f333d0b8829c11b8bf644650299c1ab6c3a6bdea5`。
- [PlayerLogin$/playerCard](pcode/cn.account.PlayerLogin--PlayerLogin__playerCard.pcode.txt)；body `74`；code SHA-256 `169790c429217a91e7422472a06e62f633b62cb44d9fed683fe7e4ca8a19adff`。
- [anonymous-method-77](pcode/cn.account.PlayerLogin--anonymous-method-77.pcode.txt)；body `75`；code SHA-256 `851e464025009e602002998346d59cd5bfc301855adca0fbc5902019dcf51512`。
- [anonymous-method-78](pcode/cn.account.PlayerLogin--anonymous-method-78.pcode.txt)；body `76`；code SHA-256 `4418daba7d453a3ce3c22830c5dbf1cac5caf7002078807adb4fb95bc7d3b127`。
- [anonymous-method-79](pcode/cn.account.PlayerLogin--anonymous-method-79.pcode.txt)；body `77`；code SHA-256 `175996617a13da655722071ef237c96f77c2dcc8eca0d254b489d7c540c7e4f9`。
- [anonymous-method-80](pcode/cn.account.PlayerLogin--anonymous-method-80.pcode.txt)；body `78`；code SHA-256 `44cca709b4544cffee7ed8e47d3be804ed31d0f233cd5094f4d0da910787d57a`。
- [PlayerLogin$/input](pcode/cn.account.PlayerLogin--PlayerLogin__input.pcode.txt)；body `79`；code SHA-256 `065e4c969c2c6071f46e7df8e1fe80260920d4ea9ea5e327c64092e07a321fbd`。
- [anonymous-method-82](pcode/cn.account.PlayerLogin--anonymous-method-82.pcode.txt)；body `80`；code SHA-256 `98b32818b9107c82c4bdb413e21fb328f3a20ead723c88f1c1e1a6ccb8775a46`。
- [PlayerLogin$/checkbox](pcode/cn.account.PlayerLogin--PlayerLogin__checkbox.pcode.txt)；body `81`；code SHA-256 `34c53e9f53372d02f38ca8640010d7a70d000390c076041e3c4bea8a8ae2e311`。
- [anonymous-method-84](pcode/cn.account.PlayerLogin--anonymous-method-84.pcode.txt)；body `82`；code SHA-256 `03ccf376ce23535dffe785d4b6ff41e15d24c8f00a41007336d58a0c5c73cf1c`。
- [PlayerLogin$/button](pcode/cn.account.PlayerLogin--PlayerLogin__button.pcode.txt)；body `83`；code SHA-256 `da3d7b0dfe4a1246f652407a9efdc0f2d78e9d8cbbbd2eeb8b6206f0535e8d47`。
- [anonymous-method-86](pcode/cn.account.PlayerLogin--anonymous-method-86.pcode.txt)；body `84`；code SHA-256 `03ccf376ce23535dffe785d4b6ff41e15d24c8f00a41007336d58a0c5c73cf1c`。
- [PlayerLogin$/link](pcode/cn.account.PlayerLogin--PlayerLogin__link.pcode.txt)；body `85`；code SHA-256 `ba91dc18405531df9326e3cdcfdd156e52940b11ef19c31e02d22abb7edd62ae`。
- [PlayerLogin$/label](pcode/cn.account.PlayerLogin--PlayerLogin__label.pcode.txt)；body `86`；code SHA-256 `1459c3b464ff6e800621e2e30832f500a1cad39eee9ce5c50fedbb678ad10cdb`。
- [PlayerLogin$/rounded](pcode/cn.account.PlayerLogin--PlayerLogin__rounded.pcode.txt)；body `87`；code SHA-256 `3027be937c36d30681bbe37e269ee7c3958c5a8e788effd72861e9a877956de2`。
- [PlayerLogin$/line](pcode/cn.account.PlayerLogin--PlayerLogin__line.pcode.txt)；body `88`；code SHA-256 `17248c1be261d0720a07c50ca5f74adf4faf11b7b6c07cae067ea19b458908ab`。
- [PlayerLogin$/badge](pcode/cn.account.PlayerLogin--PlayerLogin__badge.pcode.txt)；body `89`；code SHA-256 `93e2db8d9953fef8391b9c5a9a0c46d90d435cc687f37be62c87e44326e0712c`。
- [PlayerLogin$/<cinit>](pcode/cn.account.PlayerLogin--PlayerLogin___cinit_.pcode.txt)；body `90`；code SHA-256 `13b3c1289ac932eda376540011233d08a3397e22ce849253e9e4b5331dc35a57`。
- [PlayerLogin/<ctor>](pcode/cn.account.PlayerLogin--PlayerLogin__ctor_.pcode.txt)；body `91`；code SHA-256 `8ff32749a852a1d83829c6a3fac8ec00822f06b5c7177f9ebb43a09287b2101a`。
- [anonymous-method-0](pcode/cn.account.PlayerLogin--anonymous-method-0.pcode.txt)；body `92`；code SHA-256 `6c73681b8c49cc4aec2b71ff2f72b1beffb2b73827b1d01b2632a2b74a1346d0`。

## 补丁源与构建脚本

原样文本副本保留原始路径假设；按本次任务只归档、不执行。凡源模板还须后续脚本变换，以上最终 P-code 为最终采用状态，源文件列表表示实际构建链的输入和变换。

- [build_swf.py](source/build_swf.py) ← `D:\WF\startpoint-cn-kulo\client-patch\startup-cache\build_swf.py`；6,471 B；SHA-256 `d5dcfb6826b8f3cb462b44860c18f51aae78883c77aa26573c38425c771a3468`。
- [EmptyUpdate.as](source/EmptyUpdate.as) ← `D:\WF\startpoint-cn-kulo\client-patch\startup-cache\src\cn\asset\EmptyUpdate.as`；1,167 B；SHA-256 `cd3aa716910c136cef5659dc1c42f5dd0c421b9d28ab6d2ba452a2d18c569d87`。
