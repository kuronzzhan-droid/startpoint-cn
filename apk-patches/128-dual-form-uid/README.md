# 128 双形态动画标签指定状态UID

capability：`dual-form-uid-v1`；本地候选，未部署。
输入固定为run2/v35b.swf，方法体SHA256与header同时锁定。
最终SWF SHA256：`d0a8e186203d94ba98d78dcf14a7557fcf4c0a4cea9fcaa340250267ec326682`。

[中文数据例子与完整说明](../../README.md) · [统一验证报告](../../verify-report.json) · [统一构建入口](../../build.py)

## 现有方法合成及源文件

下面是实现目录的完整Python源码快照；运行仍使用run3根目录的工具、依赖和统一构建器。

- [voice_dual详细说明](../../voice_dual/notes.md)。
- [voice_dual/asset_inventory.py](source/voice_dual/asset_inventory.py)，SHA256 `6422159ca700dde4fdedabb4478ebb26414a92114ac0a8300448c88801f88541`。
- [voice_dual/checks.py](source/voice_dual/checks.py)，SHA256 `a86ad08fd043467d6b46d187bc583939f602d05172c830abbd1cfab7b1b56758`。
- [voice_dual/patches.py](source/voice_dual/patches.py)，SHA256 `9607ce36133cdb360d45a41981fd6e7219c3b15bbfacfd484a5c26ca5ba0b150`。
- [voice_dual/ready_audit.py](source/voice_dual/ready_audit.py)，SHA256 `2358404e742bfb3fdc81b08023d1ea49767ecd9818154a318624154735a85544`。
- [voice_dual/runtime.py](source/voice_dual/runtime.py)，SHA256 `36eb122c1ca22e84201ac76c4557dc1d93fdc53d5fe364cdc827aee24ce1849f`。
- [voice_dual/verify.py](source/voice_dual/verify.py)，SHA256 `0765f682b81980e30baf85548ac8b6656af4cba71efc81f0b3602b804680941f`。

## 最终P-code

- [MemberView/draw](pcode/MemberView__draw.pcode.txt)，body `60616`，SHA256 `d554f876ffe9149d17797abbf77ac6eb7ee22f4ebf04626c587eb27b6b31dbde`，header `[4, 26, 1, 2]`。
- [MemberView/wfxDualFormUid](pcode/MemberView__wfxDualFormUid.pcode.txt)，body `92643`，SHA256 `c8f821b6f6aa9b5456507094a6694b8c3ac5f74da7211d8fa0c638f501a460ad`，header `[4, 6, 1, 2]`。

完整AIR/Android、真实联机和设备呈现未核实。没有APK、签名、安装或发布。
