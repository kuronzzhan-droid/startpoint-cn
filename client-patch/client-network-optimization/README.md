# Independent request deadlines

This Android SWF patch restores a full timeout budget after admission for each
initial request and retains one elapsed-time deadline across that request's
retries. Exhausted retries enter the existing timeout error path before a send.
Unsigned elapsed time handles the `getTimer()` signed wrap.

`RemoteEventListenerManager` uses a one-shot AIR timer instead of the 60 FPS frame
counter. Completion/error removal stops this timer, including the original
bytecode's explicit timer type coercion. The timer can still be delayed while
the AIR thread is blocked; this is not an independent watchdog.

No HTTP payload fields, retry limits, error policy, admission protocol or persistence
formats change. Four original method bodies change and two helper ABC tags are
added, with original class layouts and constant-pool prefixes preserved.

## Reproduce

```powershell
python client-patch/client-network-optimization/patch_swf.py <input.swf> <new-output.swf>
python client-patch/client-network-optimization/run_air_tests.py <new-work-directory> --game-source <new-output.swf>
```

The AIR test executes the production insertion generator and eight actual game
manager methods against controlled transport events. It covers fresh requests,
admission restart, retry/exhausted budgets, timer cancellation, negative/zero
durations, reentrant callbacks and exactly-once completion at a 2 FPS fixture
rate. It does not establish device or live HTTP acceptance.

运行前通过 `STARPOINT_AIR_SDK` 指定 AIR SDK 51.2.1.5；`STARPOINT_JAVA` 可指定 Java 可执行文件，默认使用 PATH 中的 `java`。
