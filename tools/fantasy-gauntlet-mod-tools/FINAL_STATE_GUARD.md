# `.55` 最终态防回退守卫

## 目的

以后发布角色、能力、装备或商店补丁时，禁止直接拿某个旧版本整表覆盖当前客户端最终态。
守卫以 `1.4.55` 为历史起点，按版本顺序重放启用的补丁，并把当前最终态作为下一次发布的比较基线。

## 自动检查

每次运行 `wf_publish.py` 都会先执行：

1. 验证 `1.4.55` 以后所有已登记增量 ZIP 的大小与 SHA256；
2. 验证 manifest 版本依赖链连续，且尾版本等于 `cdn_version`；
3. 对 25 张高风险表进行文件与逐行 SHA256 比较；
4. 单独校验交易所及活动商店必保商品 ID；
5. 输出新增、修改、删除以及受保护角色相关的行 ID；
6. 未经本次精确差异批准时停止发布。

检查报告：

- `work/final_state_report.json`
- `work/final_state_baseline.json`
- `work/final_state_baseline_files/`

## 正常发布

如果发布内容没有改变受保护的最终态表，原命令不变：

```powershell
python wf_publish.py --tables carnival_event,event_item_shop
```

如果确实要修改角色、技能、装备或商店表，第一次不带批准参数运行，让工具停止并生成逐行报告。确认报告后再次运行：

```powershell
python wf_publish.py --tables ability,leader_ability --approve-final-state "调整某角色能力，已核对逐行报告"
```

批准绑定以下内容，不能复用于另一批数据：

- 当前基线版本；
- 每个文件的新旧 SHA256；
- 新增、修改、删除的确切行 ID。

发布成功后，守卫自动把新补丁 SHA256 和新最终态提交为下一版本基线。

## 重新初始化

只有在确认历史补丁链和当前最终态都可信时才允许执行：

```powershell
python wf_final_state_guard.py init
python wf_final_state_guard.py verify
```

不能用重新初始化来绕过一份尚未核对的差异报告。

