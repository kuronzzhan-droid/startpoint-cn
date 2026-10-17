// The existing deadline, immediate Leave and Finalize/close simulation runs
// unchanged against the real server with the relay process enabled.
process.env.MULTI_BATTLE_RELAY_PROCESS = '1'
require('./multi-battle-sim.test.cjs')
