# 130 直击基础按目标固有状态层数加成

延续第三轮125–129；并入 `direct-base-v1`，本地离线候选，未部署。
输出SHA256：`4fe2b1ba6267bdcd69f54be3d464ef9aba9cc07a806038ec21161762e708a212`。

[完整数据与公式](../../README.md) · [统一验收](../../verify-report.json) · [重放入口](../../build.py) · [注册表草稿](../../registry-draft.json)

修改wfxDirectFactor和wfxSpec，追加wfxDirectTargetUnique；统一构建避免覆盖同一方法。
wfxSpec仅对28/29放行负flags，满足N≤0/cap≤0；旧码规则保持。

## 源码快照

运行使用run4根目录构建器、锁文件与vendor，不将此目录当作独立工具包。

- [checks.py](source/direct_unique/checks.py)：SHA256 `8c054bbbb8f48f51f1044a20c594c619fa3f0d227f81c4a2845e08918698fb63`。
- [mutations.py](source/direct_unique/mutations.py)：SHA256 `83750ece24b824d388d2236491df7031bc3727769f25207ffa5b46d5848242dd`。
- [patches.py](source/direct_unique/patches.py)：SHA256 `7f874644d65473f2eef622c1f5e3f8cb1dae8afc7a5045a604120f7dd3ad562b`。
- [regression.py](source/direct_unique/regression.py)：SHA256 `ef4cabd09b7a815894a480a8eba716ea93f4c9cbc90b685a2a2109c1acf369f7`。
- [runtime.py](source/direct_unique/runtime.py)：SHA256 `bbbe356d59c63359f5a943d911c60fdac78b931df9e6acaa6f8f1f4c13821b52`。
- [verify.py](source/direct_unique/verify.py)：SHA256 `54aa18c3ed84ed348f8db0ee8bcea35812dfe686a73d37d2480e188873cf9dbd`。

## 最终P-code

- [ConditionSlot$/wfxSpec](pcode/ConditionSlot$__wfxSpec.pcode.txt)：SHA256 `91ca69969bd16ae753041acdb6982603f6c3dc685c2145bd8cf96c33e369dd12`，header `[5, 9, 1, 2]`。
- [MemberImpl/wfxDirectFactor](pcode/MemberImpl__wfxDirectFactor.pcode.txt)：SHA256 `79b95f994aed7627926763c51b5c320f419225b9c943bea683ec7e1cff33388a`，header `[4, 13, 1, 2]`。
- [MemberImpl/wfxDirectTargetUnique](pcode/MemberImpl__wfxDirectTargetUnique.pcode.txt)：SHA256 `b7570fd1ce5975a904ed665344d2c99d600c87a1d028ad025d494b0439bff13a`，header `[4, 10, 1, 2]`。

完整AIR、设备运行和实际战斗表现未核实；没有APK/签名/安装/服务端或发布操作。
