# Android R4 基线与公网转换（2026-10-14）

R4包含角色一览徽标延迟求值、编队动画收尾、静默数据刷新及UI/资源/网络生命周期修复，原生定期缓存删除改为标记后在下次冷启动执行。其最终内网成品是后续功能基线；公网APK直接转换该成品，保留全部R4及此前累计功能。Q1/Q2/Q3与其他未采用方案未进入本批。

## 身份与准入

- Android版本与包身份保持1.8.1 / 1008001 / `com.leiting.wf`，使用原固定签名。
- 内网APK SHA-256：`b42f52a6552cf989f9998b62f23fd291a23913901a1961e7d6b88570a1e66398`；SWF：`3f37dee12692b53cd6f9db0a21ec826366d56b8338cdfa66216fc7dbc2efde37`。
- 公网APK SHA-256：`2d4a9254548cf80effbce87a45d5bd28accb7f2e784ee68e31340bf92d365024`；SWF：`f5ed0938bb1a15c1cc17ac7e885c2eecec5cc1240e8c555debccc211ca76f2e0`。公网地址为`http://124.222.203.221:8001`，内网地址用`http://<LAN_HOST>:8001`表示。
- 内网实际准入ID沿用`android-181-author-1047-public-20261001`；公网为`android-181-r4-performance-public-20261014`并使用新密钥。配套config r2仅保留新R4、上一版Android和现用iOS三条；选定三条密钥、期限、提示、enforce保持，更早三项从允许列表与密钥文件移除。密钥只进入受限私有服务端配对和真实客户端运行载荷，不记录在此文档。
- 内网AIR UUID为`7bde929e-e3fa-48c6-8b35-75ed2d490833`；公网为`8b090599-caeb-4bc6-ac01-f969b5ae82c8`。

## 方法与保留范围

主`boot_ffc6`零基DoABC ordinal为304，原始SWF tag index为367。R4比较96706个原方法，修改其中47个目标，另有5个helper ABC/102个方法体；共305个DoABC/96808个方法体。旧登记`main_abc_index=361`不是当前DoABC ordinal，不作为定位依据。具体目标以R4成品回执和expected方法清单为准。

公网转换只改地址9处、ID及HMAC前缀3处、密钥常量2处和AIR缓存身份；目标ABC字符串池逆变换逐字节还原原ABC，其余tag、方法字节码、traits和所有非目标APK成员保持。DEX逐类回读仅缓存身份变化，保留R4原生延后缓存清理逻辑；版本、资源和包身份保持，ZIP完整性、zipalign、v1/v2签名及固定证书核验通过。

## 验证与状态

R4已有有限MuMu验证与一览等待改善数据，本批复用这些证据。基线批准单独记录为`user_confirmed_baseline=true`；两变体使用`accepted_offline`标签，公网仅补离线身份/载荷核验，不新增设备测试或把局部对照扩为手机FPS、长期内存、多人或偶发冻结率结论。服务端实际ClientAdmission类首次配对的30项检查通过；r2三条配置另有24项名单/密钥保持及撤销检查通过，覆盖新ID/HMAC、错平台、旧key误用、新旧版本并存及单条撤销隔离；未进行云服HTTP或设备联网验收。

完整私有config交付仅含`config/client-admission.keys.json`与`config/client-admission.json`。既有服务每2秒重读有效配对，先覆盖keys再覆盖允许列表；新APK须在服务端允许新号后使用。配置和APK已生成不代表云服已部署。iOS IPA、ABC/AOT和登记均未改变，这轮Android优化未移植到iOS。

原构建报告保留生成时状态；登记作为后续身份入口。R4实现与固定历史输入重建入口位于`client-comprehensive/build_swf.py`和`build_apk.py`，公网转换位于`client-public-migration/build_android.py`。重建R4使用上一正式LAN输入，不将当前R4重复套用补丁；后续功能开发从当前验收登记接续。源码与客户端登记不代表云服配置已部署。
