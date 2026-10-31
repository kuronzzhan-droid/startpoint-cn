# 131 WFX标签隐藏固有状态图标

延续前四轮112–130；扩展58号隐藏规则。状态和WFX计算不变。
输出SHA256：`89461f676b57a059bde58fe5897190db9b61013ae63947401fe1bf87106d6bcf`。

[完整说明](../../README.md) · [验收报告](../../verify-report.json) · [重放入口](../../build.py) · [累计登记草稿](../../registry-draft.json)

c0以`wfx:`开头且第6段以`hidden_`开头时隐藏，旧`hidden_`前缀继续隐藏。
`getConditionsIncludingOuterEnvironments`只追加判定；`getTotalConditions`原样取过滤后length。
所有缺段、空label、普通label均保留显示；判断区分大小写，不校验WFX数字字段。

## 源码快照

运行使用run5根目录构建器、锁文件和vendor；本目录不是独立执行入口。

- [__init__.py](source/hidden_icons/__init__.py)：SHA256 `5932c207199b78916b1655186c41261db6829b8da65e11de0de4c89164a9cd68`。
- [cases.py](source/hidden_icons/cases.py)：SHA256 `478fa6ede333cd265b9f02adee2493041b5f456156f21540f7b71639a77325e0`。
- [mutations.py](source/hidden_icons/mutations.py)：SHA256 `a88ee93fcea377d138ed15d06c8d0da24250fe3cd81f26a85d0d514dd182a3e5`。
- [patches.py](source/hidden_icons/patches.py)：SHA256 `911b0041d934db973148e5b12783f08496143ec4f831f5c0897ecf866fd586bb`。
- [queries.py](source/hidden_icons/queries.py)：SHA256 `a1699e6ed0b0c11591e7b6c61d447d9dd88d81529cc57201bc504bbdcb593f75`。
- [runtime.py](source/hidden_icons/runtime.py)：SHA256 `884e91c6b558730fda597877ef194665c039018ffdc138e878010843f58e16ee`。
- [verify.py](source/hidden_icons/verify.py)：SHA256 `ea418c3e5ffa0d373677ebcebb5e009b912b5a426971b45b96efea0a5b0a9c05`。

## 最终P-code

- [MemberImpl/getConditionsIncludingOuterEnvironments](pcode/MemberImpl__getConditionsIncludingOuterEnvironments.pcode.txt)：SHA256 `1a75e43905e12699092cbc05d7469cc273ef45636022e9be94b71f6d0011d41b`，header `[3, 8, 1, 2]`。

完整AIR、Android设备与战斗视觉表现未核实；未联网、签名、安装、发布或部署。
