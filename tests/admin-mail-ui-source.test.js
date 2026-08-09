const assert = require("assert")
const fs = require("fs")
const path = require("path")

const mailSource = fs.readFileSync(path.join(__dirname, "../admin/src/pages/Mail.tsx"), "utf8")

const privateServerTypeLabels = [
    "付费星导石",
    "星之碎片",
    "玛纳",
    "经验池",
    "称号",
]

for (const label of privateServerTypeLabels) {
    assert(mailSource.includes(label), `私服邮件附件类型应继续展示：${label}`)
}

const attachmentRequiredMessages = mailSource.match(/"请选择附件"/g) ?? []
assert.strictEqual(attachmentRequiredMessages.length, 1, "附件字段清空时只能产生一条“请选择附件”校验提示")

const typeItemMatch = mailSource.match(/<Form\.Item name="type"[\s\S]*?<\/Form\.Item>/)
assert(typeItemMatch, "应存在附件类型 Form.Item")
const typeItemSource = typeItemMatch[0]
assert(typeItemSource.includes("<Radio.Group"), "附件类型应使用可见快速选择控件")
assert(!typeItemSource.includes("<Select"), "附件类型不应继续使用下拉 Select")
assert(mailSource.includes("发送后无法撤回"), "发送前应保留高风险确认提示")
assert(mailSource.includes('placeholder="称号 ID"'), "称号附件应提供数字 ID 输入")
assert(!mailSource.includes('apiGet<PlayerBrief[]>("/api/player")'), "指定存档不能使用默认分页的玩家接口")
assert(mailSource.includes("accounts.flatMap(account => account.players)"), "指定存档应从账号接口读取全部存档")
assert(mailSource.includes("按存档、账号 ID 或备注搜索"), "指定存档搜索应覆盖账号 ID 和备注")
assert(mailSource.includes("按原始账号 ID、内部 ID 或备注搜索"), "指定账号搜索应覆盖 viewer_id 和备注")
assert(mailSource.includes("account.viewerId ?? \"未生成 viewer_id\""), "指定账号选项应优先显示 viewer_id")

console.log("admin-mail-ui-source tests passed")
