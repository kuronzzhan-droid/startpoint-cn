# 五王房主提前返房

五王个人奖励结算成功时，全局 run 可能仍等待其他成员。房主的 prepare 可返回大厅连接信息，但房间权威阶段保持 BATTLE；大厅 Enter 此时不能直接改写冻结战斗名单或提前开始下一局。

服务端仅为同实例、同代、同 battle/run/play 的已 SETTLED 原房主保存一次提前 Enter。暂存依附当前大厅连接，每连接最多一项；payload 上限为默认 TCP 帧预算 262144 字节，等待最多180秒，`REMATCH_RESULT_WAIT_MAX_MS` 配置更短时使用更短值。重复 Enter 不延长期限，也不积累监听器。原成员列表、个人结果状态、battle generation 和 enterData 在等待期间不变。

全局正常终态在同一房间 FIFO 内转为 RETURNING，重新核对当前连接、实例、代、run和个人play、结果状态及期限，先清除暂存，再同步走实际 Enter 分支完成 Welcome和房主返大厅。个人仍未返回的队友预留继续生效，自动或直接开战仍须满足原名单规则。个人结果提交已经证明该玩家完成战斗，返回动作不使用场景屏障权限，也不回放战斗控制帧。

连接替换、移除、end/close、房间清理都会释放该连接的暂存。全局 abort沿用解散流程，不重放 Enter；期限或payload预算到达时给仍等待的连接发送原生 Disbanded并结束连接，不自动abort持久run。owner队列不可用时只释放暂存和连接，不在队列外修改房间权威状态。

本逻辑不放行普通关卡、未 SETTLED 房主或客机的 BATTLE 入房，不修改普通 RETIRED成员的结算处理。回归入口是 `tests/five-boss-early-host-return.test.cjs`，实际执行prepare、handshake、Enter与全局终态handler；真实SessionManager替换/移除钩子另由 `tests/multi-rematch-return-reservations.test.cjs` 覆盖。
