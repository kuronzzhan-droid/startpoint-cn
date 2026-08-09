require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { accountHasNote, selectUnnotedAccountIds } = require("../src/lib/admin-account-cleanup")

assert.equal(accountHasNote([]), false)
assert.equal(accountHasNote([{ account_id: 1, name: null }]), false)
assert.equal(accountHasNote([{ account_id: 1, name: "   " }]), false)
assert.equal(accountHasNote([{ account_id: 1, name: "玩家甲" }]), true)
assert.equal(accountHasNote([
    { account_id: 1, name: null },
    { account_id: 1, name: "保留" },
]), true)

assert.deepEqual(
    selectUnnotedAccountIds(
        [1, 2, 3, 4],
        [
            { account_id: 1, name: null },
            { account_id: 2, name: "已备注" },
            { account_id: 3, name: " " },
        ],
        3,
    ),
    [1, 4],
    "无绑定账号也属于未备注账号，但当前活动账号必须跳过",
)

console.log("admin account cleanup tests passed")
