import { useEffect, useMemo, useState } from "react"
import {
    Alert, Button, Card, Col, DatePicker, Divider, Empty, InputNumber, Modal, Popconfirm,
    Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Tooltip, Typography, message
} from "antd"
import { ClockCircleOutlined, ReloadOutlined, TrophyOutlined } from "@ant-design/icons"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnsType } from "antd/es/table"
import type { Dayjs } from "dayjs"
import { apiGet, apiPost, apiPut } from "../api/client"

interface BoardStats {
    totalRuns: number
    completedRuns: number
    fullRuns: number
    abandonedRuns: number
    activeRuns: number
    bestBattleMs: number | null
    /** 战斗用时榜**去重后**的行数 = 有完整成绩的存档数（**跨期累计**）。 */
    rankedPlayers: number
    /** **当期**的完整成绩数；没有期次台账时是 null。 */
    seasonFullRuns: number | null
    /** **当期**去重后的上榜存档数 = 当期榜实际有几行；没有期次台账时是 null。 */
    seasonRankedPlayers: number | null
}

interface EventRow {
    eventId: number
    folderId: number
    totalRounds: number
    season: number | null
    seasonStartedAt: string | null
    seasonSource: string | null
    stats: BoardStats
}

interface BoardRow {
    runId: number
    playerId: number
    playerName: string | null
    playerExists: boolean
    season: number
    status: string
    startedAt: string | null
    finishedAt: string | null
    durationMs: number | null
    battleMs: number
    roundsCleared: number
    totalRounds: number
    trackedFromRound: number
    fullRun: boolean
    characterIds: (number | null)[]
    unisonCharacterIds: (number | null)[]
}

interface BoardResponse {
    eventId: number
    folderId: number
    totalRounds: number
    season: number | null
    rows: BoardRow[]
}

type CharacterLookup = Record<string, { name: string; title: string; rarity: string; element: string }>

/** 毫秒 → 1:23:45.678 / 23:45.678,榜上要能一眼比长短。 */
function formatDuration(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return "-"
    const totalMs = Math.max(0, Math.round(ms))
    const hours = Math.floor(totalMs / 3_600_000)
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
    const seconds = Math.floor((totalMs % 60_000) / 1000)
    const millis = totalMs % 1000
    const tail = `${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${tail}`
        : `${minutes}:${tail}`
}

function formatTime(iso: string | null): string {
    return iso === null ? "-" : new Date(iso).toLocaleString("zh-CN")
}

const statusMeta: Record<string, { color: string; label: string }> = {
    completed: { color: "green", label: "已通关" },
    active: { color: "processing", label: "进行中" },
    abandoned: { color: "default", label: "已作废" }
}

interface RewardTier {
    fromRank: number
    /** null = 从 fromRank 一直到榜尾。 */
    toRank: number | null
    itemId: number | null
    count: number
    /** 称号(铭牌)ID;null = 该档不发称号。称号直接进拥有集合,不走邮件。 */
    degreeId?: number | null
}

interface SettlementConfig {
    autoEnabled: boolean
    settleAtMs: number | null
    repeatIntervalMs: number | null
    rewardBoard: "full-run" | "season-first"
    rewardRankLimit: number
    rewardTiers: RewardTier[]
    mailSubject: string
    mailBody: string
    updatedAtMs: number
    /** 机器人(accounts.idp_code='rushbot' 名下的存档)发不发奖;true = 不发。 */
    excludeBots: boolean
}

interface SettlementLedger {
    id: number
    season: number
    settledAtMs: number
    source: string
    nextSeason: number
    fullRunRows: number
    seasonFirstRows: number
    mailCount: number
    note: string | null
}

interface SettlementResponse {
    eventId: number
    folderId: number
    currentSeason: number | null
    nowMs: number
    config: SettlementConfig
    rewardsConfigured: boolean
    history: SettlementLedger[]
}

interface FrozenRow {
    board: string
    rank: number
    playerId: number
    playerName: string | null
    durationMs: number | null
    battleMs: number | null
    rewardItemId: number | null
    rewardCount: number | null
    mailId: number | null
    /** 占了名次却没发奖的原因:'bot' / 'deleted';null = 正常。 */
    skipReason: string | null
}

const DAY_MS = 86_400_000

/** 结算时刻一律以 epoch 毫秒在接口上流动，这里按浏览器本地时区渲染。 */
function fmtMs(ms: number | null | undefined): string {
    return ms === null || ms === undefined ? "-" : new Date(ms).toLocaleString("zh-CN")
}

// ⚠ 本页「队伍」列画的是**那一程的实战队伍快照**(成绩行里的 characterIds),
//   和游戏内原生榜行不一样 —— 后者 2026-08-28 起改画「个人资料里的前三个角色」
//   (src/lib/rush-leaderboard-native-rows.ts 文件头「三个头像画的是谁」)。
//   **这是刻意保留的**:后台这一页的用途正是排障看「他那一程到底打了什么」。

function SettlementCard({ eventId, folderId }: { eventId: number; folderId: number }) {
    const qc = useQueryClient()
    const [picked, setPicked] = useState<Dayjs | null>(null)
    const [tierDraft, setTierDraft] = useState<RewardTier[] | null>(null)
    const [historySeason, setHistorySeason] = useState<number | null>(null)

    const key = ["rushSettlement", eventId, folderId]
    const { data, isLoading } = useQuery({
        queryKey: key,
        queryFn: () => apiGet<SettlementResponse>(
            `/api/rush-leaderboard/${eventId}/settlement?folderId=${folderId}`)
    })

    const tiers = tierDraft ?? data?.config.rewardTiers ?? []

    const save = useMutation({
        mutationFn: (patch: Record<string, unknown>) =>
            apiPut(`/api/rush-leaderboard/${eventId}/settlement?folderId=${folderId}`, patch),
        onSuccess: () => {
            message.success("结算配置已保存")
            setTierDraft(null)
            void qc.invalidateQueries({ queryKey: key })
        },
        onError: (e: Error) => message.error(e.message)
    })

    const settleNow = useMutation({
        mutationFn: () => apiPost<{ season: number; nextSeason: number; mailCount: number }>(
            `/api/rush-leaderboard/${eventId}/settlement/run?folderId=${folderId}`),
        onSuccess: (r) => {
            message.success(`第 ${r.season} 期已结算，发奖 ${r.mailCount} 封，已开启第 ${r.nextSeason} 期`)
            void qc.invalidateQueries({ queryKey: key })
            void qc.invalidateQueries({ queryKey: ["rushLeaderboard"] })
            void qc.invalidateQueries({ queryKey: ["rushLeaderboardEvents"] })
        },
        onError: (e: Error) => message.error(e.message)
    })

    const { data: frozen } = useQuery({
        queryKey: ["rushSettlementResults", eventId, folderId, historySeason],
        queryFn: () => apiGet<{ rows: FrozenRow[] }>(
            `/api/rush-leaderboard/${eventId}/settlement/${historySeason}/results?folderId=${folderId}`),
        enabled: historySeason !== null
    })

    const updateTier = (index: number, patch: Partial<RewardTier>) => {
        const next = tiers.map((t, i) => (i === index ? { ...t, ...patch } : t))
        setTierDraft(next)
    }

    const tierColumns: ColumnsType<RewardTier> = [
        {
            title: "名次自", dataIndex: "fromRank", width: 90,
            render: (v: number, _r, i) => (
                <InputNumber min={1} value={v} size="small" style={{ width: 70 }}
                    onChange={(val) => updateTier(i, { fromRank: Number(val ?? 1) })} />
            )
        },
        {
            title: "名次至", dataIndex: "toRank", width: 210,
            render: (v: number | null, row, i) => (
                <Space size="small">
                    <InputNumber min={1} value={v ?? undefined} disabled={v === null}
                        placeholder="榜尾" size="small" style={{ width: 70 }}
                        onChange={(val) => val !== null
                            && updateTier(i, { toRank: Number(val) })} />
                    <Switch size="small" checked={v === null}
                        checkedChildren="到榜尾" unCheckedChildren="有限"
                        onChange={(checked) => updateTier(i, {
                            toRank: checked ? null : Math.max(row.fromRank, row.toRank ?? row.fromRank)
                        })} />
                </Space>
            )
        },
        {
            title: "道具 ID", dataIndex: "itemId", width: 150,
            render: (v: number | null, _r, i) => (
                <InputNumber min={1} value={v ?? undefined} size="small" style={{ width: 130 }}
                    placeholder="未配置"
                    onChange={(val) => updateTier(i, { itemId: val === null ? null : Number(val) })} />
            )
        },
        {
            title: "数量", dataIndex: "count", width: 90,
            render: (v: number, _r, i) => (
                <InputNumber min={1} value={v} size="small" style={{ width: 70 }}
                    onChange={(val) => updateTier(i, { count: Number(val ?? 1) })} />
            )
        },
        {
            title: "称号 ID", dataIndex: "degreeId", width: 150,
            render: (v: number | null | undefined, _r, i) => (
                <InputNumber min={1} value={v ?? undefined} size="small" style={{ width: 130 }}
                    placeholder="不发称号"
                    onChange={(val) => updateTier(i, { degreeId: val === null ? null : Number(val) })} />
            )
        },
        {
            title: "", key: "op", width: 60,
            render: (_: unknown, _r, i) => (
                <Button type="text" danger size="small"
                    onClick={() => setTierDraft(tiers.filter((_t, j) => j !== i))}>删除</Button>
            )
        }
    ]

    const historyColumns: ColumnsType<SettlementLedger> = [
        { title: "期", dataIndex: "season", width: 70, render: (v: number) => `第 ${v} 期` },
        { title: "结算时间", dataIndex: "settledAtMs", width: 190, render: fmtMs },
        { title: "发奖", dataIndex: "mailCount", width: 80, render: (v: number) => `${v} 封` },
        { title: "冻结行数", key: "rows", width: 130,
            render: (_: unknown, r) => `${r.fullRunRows} / ${r.seasonFirstRows}` },
        { title: "来源", dataIndex: "source", width: 130 },
        { title: "备注", dataIndex: "note", ellipsis: true,
            render: (v: string | null) => v ? <Typography.Text type="warning">{v}</Typography.Text> : "-" },
        {
            title: "", key: "op", width: 90,
            render: (_: unknown, r) => (
                <Button type="link" size="small" onClick={() => setHistorySeason(r.season)}>看名次</Button>
            )
        }
    ]

    if (isLoading || !data) return <Card title="赛季结算" loading />

    const cfg = data.config

    return (
        <Card title={<Space><ClockCircleOutlined />赛季结算</Space>}>
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                {!data.rewardsConfigured && (
                    <Alert type="warning" showIcon
                        message="奖励档位还没配置"
                        description="所有档位都没有有效道具或称号；结算仍会冻结名次并开新一期，但不会发出奖励。请在下面至少配置一项道具或称号。" />
                )}

                <Row gutter={[16, 16]}>
                    <Col xs={24} sm={12} md={8}>
                        <Statistic title="当前期" value={data.currentSeason ?? "-"} prefix="第" suffix="期" />
                    </Col>
                    <Col xs={24} sm={12} md={8}>
                        <Statistic title="下次自动结算" value={fmtMs(cfg.settleAtMs)} />
                    </Col>
                    <Col xs={24} sm={12} md={8}>
                        <Statistic title="已结算" value={data.history.length} suffix="期" />
                    </Col>
                </Row>

                <Divider style={{ margin: "4px 0" }} />

                <Space wrap align="center">
                    <span>自动结算</span>
                    <Switch checked={cfg.autoEnabled}
                        onChange={(checked) => save.mutate({ autoEnabled: checked })} />
                    <DatePicker showTime value={picked} onChange={setPicked}
                        placeholder="结算时刻（本地时区）" format="YYYY-MM-DD HH:mm" />
                    <Button disabled={!picked} loading={save.isPending}
                        onClick={() => picked && save.mutate({
                            settleAtMs: picked.valueOf(), autoEnabled: true })}>
                        设定排期
                    </Button>
                    <Button disabled={cfg.settleAtMs === null}
                        onClick={() => save.mutate({ settleAtMs: null, autoEnabled: false })}>
                        取消排期
                    </Button>
                    <Select style={{ width: 150 }} value={cfg.repeatIntervalMs ?? 0}
                        onChange={(v) => save.mutate({ repeatIntervalMs: v === 0 ? null : v })}
                        options={[
                            { value: 0, label: "一次性" },
                            { value: DAY_MS, label: "每 1 天顺延" },
                            { value: DAY_MS * 7, label: "每 7 天顺延" },
                            { value: DAY_MS * 14, label: "每 14 天顺延" },
                            { value: DAY_MS * 30, label: "每 30 天顺延" }
                        ]} />
                </Space>

                <Space wrap align="center">
                    <span>发奖依据</span>
                    <Select style={{ width: 160 }} value={cfg.rewardBoard}
                        onChange={(v) => save.mutate({ rewardBoard: v })}
                        options={[
                            { value: "full-run", label: "战斗用时榜" },
                            { value: "season-first", label: "当轮首通榜" }
                        ]} />
                    <Tooltip title="只截断 toRank 不为 null 的有限档；到榜尾档不受此数值限制">
                        <span>有限档截断至第</span>
                    </Tooltip>
                    <InputNumber min={1} max={500} value={cfg.rewardRankLimit} style={{ width: 80 }}
                        onChange={(v) => v && save.mutate({ rewardRankLimit: Number(v) })} />
                    <span>名</span>
                    {/* 机器人「占名次但不发奖」:游戏内榜的名次不变,只是拿不到邮件。 */}
                    <Tooltip title="默认打开：机器人照常占名次，但不获得道具或称号；关掉后机器人也发奖">
                        <span>机器人不发奖（默认）</span>
                    </Tooltip>
                    <Switch checked={cfg.excludeBots}
                        onChange={(checked) => save.mutate({ excludeBots: checked })} />
                    <Popconfirm
                        title={`立即结算第 ${data.currentSeason ?? "?"} 期？`}
                        description="会冻结当前名次；有限档按截断线发奖，到榜尾档继续覆盖完整通关玩家，然后开启新一期。同一期不会被结算两次。"
                        okText="确认结算" cancelText="取消" okButtonProps={{ danger: true }}
                        onConfirm={() => settleNow.mutate()}
                    >
                        <Button type="primary" danger loading={settleNow.isPending}>立即结算</Button>
                    </Popconfirm>
                </Space>

                <div>
                    <Typography.Text strong>奖励档位</Typography.Text>
                    <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                        区间重叠时靠前档位优先且不叠加；到榜尾档不受有限截断线限制，
                        只覆盖完整通关玩家；道具/称号 ID 留空分别表示不发
                    </Typography.Text>
                    <Table<RewardTier>
                        rowKey={(_r, i) => String(i)}
                        size="small" pagination={false} style={{ marginTop: 8 }}
                        columns={tierColumns} dataSource={tiers}
                        scroll={{ x: "max-content" }}
                    />
                    <Space style={{ marginTop: 8 }} wrap>
                        <Button size="small" onClick={() => setTierDraft([
                            ...tiers, { fromRank: 1, toRank: 1, itemId: null, count: 1, degreeId: null }])}>新增档位</Button>
                        <Button size="small" type="primary" disabled={tierDraft === null}
                            loading={save.isPending}
                            onClick={() => save.mutate({ rewardTiers: tierDraft })}>保存档位</Button>
                        <Button size="small" disabled={tierDraft === null}
                            onClick={() => setTierDraft(null)}>放弃修改</Button>
                    </Space>
                </div>

                <div>
                    <Typography.Text strong>历史赛季</Typography.Text>
                    <Table<SettlementLedger>
                        rowKey="id" size="small" style={{ marginTop: 8 }}
                        pagination={{ pageSize: 5, hideOnSinglePage: true }}
                        columns={historyColumns} dataSource={data.history}
                        scroll={{ x: "max-content" }}
                        locale={{ emptyText: <Empty description="还没有结算过" /> }}
                    />
                </div>
            </Space>

            <Modal
                open={historySeason !== null}
                title={`第 ${historySeason} 期冻结名次`}
                footer={null}
                width={720}
                onCancel={() => setHistorySeason(null)}
            >
                <Table<FrozenRow>
                    rowKey={(r) => `${r.board}-${r.rank}`}
                    size="small"
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                    dataSource={frozen?.rows ?? []}
                    scroll={{ x: "max-content" }}
                    columns={[
                        { title: "榜", dataIndex: "board", width: 110,
                            render: (v: string) => v === "full-run" ? "战斗用时" : "当轮首通" },
                        { title: "名次", dataIndex: "rank", width: 70 },
                        { title: "存档", dataIndex: "playerName", width: 150,
                            render: (v: string | null, r) => v || `#${r.playerId}` },
                        { title: "战斗用时", dataIndex: "battleMs", width: 120, render: formatDuration },
                        { title: "全程墙钟", dataIndex: "durationMs", width: 120, render: formatDuration },
                        { title: "奖励", key: "reward", width: 160,
                            render: (_: unknown, r) => r.rewardItemId
                                ? `道具 ${r.rewardItemId} × ${r.rewardCount}` : "-" },
                        { title: "未发奖原因", dataIndex: "skipReason", width: 120,
                            render: (v: string | null) => v === "bot"
                                ? <Tag color="purple">机器人</Tag>
                                : v === "deleted"
                                    ? <Tag color="red">存档已删</Tag>
                                    : v ? <Tag>{v}</Tag> : "-" }
                    ]}
                />
            </Modal>
        </Card>
    )
}

export default function RushLeaderboard() {
    const qc = useQueryClient()
    const [selected, setSelected] = useState<string | null>(null)

    const { data: events = [], isLoading: eventsLoading, isError: eventsError, isFetching: eventsFetching } = useQuery({
        queryKey: ["rushLeaderboardEvents"],
        queryFn: () => apiGet<EventRow[]>("/api/rush-leaderboard/events")
    })

    const { data: characters } = useQuery({
        queryKey: ["lookupCharacters"],
        queryFn: () => apiGet<CharacterLookup>("/api/lookup/characters"),
        staleTime: Infinity
    })

    // 默认选中记录最多的那一档(通常就是深渊连战 700099 / folder 1)
    useEffect(() => {
        if (selected !== null || events.length === 0) return
        const best = [...events].sort((left, right) =>
            right.stats.completedRuns - left.stats.completedRuns
            || right.totalRounds - left.totalRounds)[0]
        if (best) setSelected(`${best.eventId}:${best.folderId}`)
    }, [events, selected])

    const current = useMemo(
        () => events.find(row => `${row.eventId}:${row.folderId}` === selected) ?? null,
        [events, selected]
    )

    const boardQuery = (kind: "full-run" | "season-first" | "runs") => ({
        queryKey: ["rushLeaderboard", kind, current?.eventId, current?.folderId],
        queryFn: () => apiGet<BoardResponse>(
            `/api/rush-leaderboard/${current!.eventId}/${kind}?folderId=${current!.folderId}`),
        enabled: current !== null
    })

    const fullRun = useQuery(boardQuery("full-run"))
    const seasonFirst = useQuery(boardQuery("season-first"))
    const allRuns = useQuery(boardQuery("runs"))

    const rollover = useMutation({
        mutationFn: () => apiPost<{
            season: number, rolled: boolean, settled: boolean, settleReason: string | null,
            settlement: { mailCount?: number } | null
            // 显式发一个 `{}`。`apiPost` 不带 body 时发的是
            // `Content-Type: application/json` + 空 body——**裸 Fastify 对这种请求回
            // 400 FST_ERR_CTP_EMPTY_JSON_BODY**，今天能通只是因为 cn-server 给
            // application/json 装了个会吞解析错误的自定义 parser（src/cn-server.ts）。
            // 这个端点现在还被 CLI `wf_rogue_reroll.py` 和 GUI 三条发布路调用，
            // 让所有调用方发同一种、在任何 parser 配置下都合法的形状，
            // 免得哪天 parser 一收紧就静默换不了期（表现是「新塔挂着旧榜」，没人会立刻发现）。
        }>(`/api/rush-leaderboard/${current!.eventId}/season/rollover`, {}),
        onSuccess: (result) => {
            // 这个按钮 2026-08-28 起是「先结算再换期」：只换期的话上一期的名次冻结和
            // 奖励邮件永远补不回来。结算跑没跑成必须说出来，别让人以为奖发过了。
            //
            // 结算**真失败**时端点返回 409，走的是下面的 onError（期号一格没动）；
            // 这里只会看到三种：结算成功、良性跳过（这一期已经结算过）照常换期、
            // 以及**这一期还没人打过 ⇒ 原地复用**（`rolled=false`，期号不动）。
            // 最后那种必须照实说：报「已开启第 N 期」而期号其实没动，
            // 下次就没人信这行提示了。
            if (result.settled) {
                message.success(
                    `已结算并开启第 ${result.season} 期（发出 ${result.settlement?.mailCount ?? 0} 封奖励邮件）`)
            } else if (!result.rolled) {
                message.info(
                    `第 ${result.season} 期还没人打过，期号保持不动（已重新对上当前这座塔，`
                    + `进行中的挑战已作废）：${result.settleReason ?? "这一期是空的"}`)
            } else {
                message.warning(
                    `已开启第 ${result.season} 期，但**没有结算**：${result.settleReason ?? "未知原因"}`)
            }
            void qc.invalidateQueries({ queryKey: ["rushLeaderboardEvents"] })
            void qc.invalidateQueries({ queryKey: ["rushLeaderboard"] })
            void qc.invalidateQueries({ queryKey: ["rushSettlement"] })
        },
        onError: (error: Error) => message.error(error.message)
    })

    const refreshAll = () => {
        void qc.invalidateQueries({ queryKey: ["rushLeaderboardEvents"] })
        void qc.invalidateQueries({ queryKey: ["rushLeaderboard"] })
    }

    const partyText = (row: BoardRow): string => {
        const names = [...row.characterIds, ...row.unisonCharacterIds]
            .filter((id): id is number => id !== null)
            .map(id => characters?.[String(id)]?.name ?? `#${id}`)
        return names.length === 0 ? "-" : names.join(" / ")
    }

    const nameColumn: ColumnsType<BoardRow>[number] = {
        title: "存档",
        dataIndex: "playerName",
        width: 160,
        render: (_: unknown, row: BoardRow) => (
            <Space size={4}>
                <span>{row.playerName || `#${row.playerId}`}</span>
                {!row.playerExists && <Tooltip title="该存档已删除，这是留存的历史成绩"><Tag>历史</Tag></Tooltip>}
            </Space>
        )
    }

    const partyColumn: ColumnsType<BoardRow>[number] = {
        title: "通关队伍",
        key: "party",
        ellipsis: true,
        render: (_: unknown, row: BoardRow) => (
            <Typography.Text type="secondary">{partyText(row)}</Typography.Text>
        )
    }

    const fullRunColumns: ColumnsType<BoardRow> = [
        { title: "名次", key: "rank", width: 70, render: (_: unknown, __: BoardRow, index: number) => index + 1 },
        nameColumn,
        {
            title: "战斗用时",
            dataIndex: "battleMs",
            width: 130,
            render: (value: number) => <strong>{formatDuration(value)}</strong>
        },
        { title: "全程墙钟", dataIndex: "durationMs", width: 130, render: formatDuration },
        { title: "期", dataIndex: "season", width: 70, render: (value: number) => `第 ${value} 期` },
        { title: "通关时间", dataIndex: "finishedAt", width: 190, render: formatTime },
        partyColumn
    ]

    const seasonFirstColumns: ColumnsType<BoardRow> = [
        { title: "期", dataIndex: "season", width: 80, render: (value: number) => <Tag color="blue">第 {value} 期</Tag> },
        nameColumn,
        { title: "首通时间", dataIndex: "finishedAt", width: 190, render: formatTime },
        {
            title: "战斗用时",
            dataIndex: "battleMs",
            width: 150,
            render: (value: number, row: BoardRow) => (
                <Space size={4}>
                    <span>{row.fullRun ? formatDuration(value) : "--:--.--"}</span>
                    {!row.fullRun && (
                        <Tooltip title={`从第 ${row.trackedFromRound} 关才接管，只累计了这之后的战斗用时，不能当成绩比`}>
                            <Tag color="warning">不完整</Tag>
                        </Tooltip>
                    )}
                </Space>
            )
        },
        { title: "全程墙钟", dataIndex: "durationMs", width: 130, render: formatDuration },
        partyColumn
    ]

    const allRunColumns: ColumnsType<BoardRow> = [
        { title: "#", dataIndex: "runId", width: 70 },
        nameColumn,
        {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (value: string) => {
                const meta = statusMeta[value] ?? { color: "default", label: value }
                return <Tag color={meta.color}>{meta.label}</Tag>
            }
        },
        {
            title: "进度",
            key: "progress",
            width: 100,
            render: (_: unknown, row: BoardRow) => `${row.roundsCleared} / ${row.totalRounds}`
        },
        { title: "期", dataIndex: "season", width: 70, render: (value: number) => `第 ${value} 期` },
        { title: "开始", dataIndex: "startedAt", width: 190, render: formatTime },
        { title: "结束", dataIndex: "finishedAt", width: 190, render: formatTime },
        { title: "战斗用时", dataIndex: "battleMs", width: 130, render: formatDuration },
        { title: "全程墙钟", dataIndex: "durationMs", width: 130, render: formatDuration }
    ]

    const table = (rows: BoardRow[] | undefined, columns: ColumnsType<BoardRow>, loading: boolean, empty: string) => (
        <Table<BoardRow>
            rowKey="runId"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={rows ?? []}
            pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
            scroll={{ x: "max-content" }}
            locale={{ emptyText: <Empty description={empty} /> }}
        />
    )

    if (eventsError) {
        return <Alert type="error" showIcon message="排行榜数据加载失败" description="接口 /api/rush-leaderboard/events 不可用。" />
    }

    return (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Card
                title={<Space><TrophyOutlined />深渊连战排行榜</Space>}
                extra={<Button type="text" icon={<ReloadOutlined />} loading={eventsFetching} onClick={refreshAll}>刷新</Button>}
            >
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                    <Space wrap>
                        <Select
                            style={{ minWidth: 300 }}
                            loading={eventsLoading}
                            value={selected}
                            onChange={setSelected}
                            placeholder="选择连战"
                            options={events.map(row => ({
                                value: `${row.eventId}:${row.folderId}`,
                                label: `连战 ${row.eventId} · folder ${row.folderId} · ${row.totalRounds} 关`
                            }))}
                        />
                        {current && (
                            <Popconfirm
                                title={`结算第 ${current.season ?? 1} 期并开启第 ${(current.season ?? 0) + 1} 期？`}
                                description="重摇过塔之后点这里：会先冻结当期名次，按配置发道具或称号（有限档受截断线限制，到榜尾档只覆盖完整通关玩家），再换期。进行中的挑战会作废，历史成绩全部保留。这一期若已结算过则只换期不发奖；若一条完整成绩都没有，则期号原地不动、只把这一期重新对上新塔（空期换一次就白烧一个不可逆的期号）；结算真出错时会拒绝换期（期号不动），修好后重试即可。"
                                okText="确认" cancelText="取消"
                                onConfirm={() => rollover.mutate()}
                            >
                                <Button loading={rollover.isPending}>结算并开启新一期</Button>
                            </Popconfirm>
                        )}
                    </Space>

                    {current ? (
                        <Row gutter={[16, 16]}>
                            <Col xs={12} sm={8} md={6}>
                                <Statistic title="当前期" value={current.season ?? "-"} prefix="第" suffix="期" />
                            </Col>
                            <Col xs={12} sm={8} md={6}>
                                <Statistic title="最好战斗用时" value={formatDuration(current.stats.bestBattleMs)} />
                            </Col>
                            <Col xs={12} sm={8} md={6}>
                                <Statistic title="通关次数" value={current.stats.completedRuns} />
                            </Col>
                            <Col xs={12} sm={8} md={6}>
                                {/* 去重后才是榜上的行数:一位玩家只记录他最优的一程
                                    (作者裁定 2026-08-28)。两个数一起显示,否则
                                    「完整成绩 4 条、榜上只有 3 行」看起来像丢数据。
                                    ⚠ 这一格是**当期**的 —— 榜本身已按期收窄,只显示
                                    跨期累计数的话换期后会一边写「26 条」一边给出空榜。 */}
                                <Statistic title="当期上榜存档 / 当期完整成绩"
                                    value={current.stats.seasonRankedPlayers === null
                                        ? `${current.stats.rankedPlayers} / ${current.stats.fullRuns}`
                                        : `${current.stats.seasonRankedPlayers} / ${current.stats.seasonFullRuns}`} />
                            </Col>
                            <Col xs={12} sm={8} md={6}>
                                {/* 跨期累计另开一格:换期不删数据,历史成绩全在库里
                                    (走「全部记录」页或某一期的结算快照能查到)。 */}
                                <Statistic title="累计上榜存档 / 累计完整成绩"
                                    value={`${current.stats.rankedPlayers} / ${current.stats.fullRuns}`} />
                            </Col>
                            <Col xs={12} sm={8} md={6}>
                                <Statistic title="进行中 / 已作废" value={`${current.stats.activeRuns} / ${current.stats.abandonedRuns}`} />
                            </Col>
                            <Col span={24}>
                                <Typography.Text type="secondary">
                                    本期自 {formatTime(current.seasonStartedAt)} 起
                                    {current.seasonSource ? `（来源：${current.seasonSource}）` : ""}
                                    ；全程 {current.totalRounds} 关。
                                </Typography.Text>
                            </Col>
                        </Row>
                    ) : (
                        <Empty description={eventsLoading ? "加载中…" : "没有可上榜的连战"} />
                    )}
                </Space>
            </Card>

            {current && <SettlementCard eventId={current.eventId} folderId={current.folderId} />}

            {current && (
                <Card>
                    <Tabs
                        items={[
                            {
                                key: "full-run",
                                label: "战斗用时榜",
                                children: (
                                    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                                        <Alert
                                            type="info" showIcon
                                            message="计时口径"
                                            description={`第 1 关到第 ${current.totalRounds} 关，每一关战斗结算时间之和；关间选队、整备、读条、掉线一律不计。必须是同一次从第 1 关连续爬到顶的成绩，不能把多次挑战的分层拼起来。中途放弃或从第 1 关重开则该次作废。每个存档只保留最好的那一次，重打更快才刷新名次，不如上次则不覆盖。`}
                                        />
                                        {table(fullRun.data?.rows, fullRunColumns, fullRun.isLoading, "还没有完整通关记录")}
                                    </Space>
                                )
                            },
                            {
                                key: "season-first",
                                label: "当轮首通榜",
                                children: (
                                    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                                        <Alert
                                            type="info" showIcon
                                            message="轮次口径"
                                            description="一「期」= 一座塔。重摇塔（服务端重摇钩子命中，或在这里手动「开启新一期」）才换期；单纯的整段重置重打同一座塔仍属同一期。每期每个存档只取最早的那次通关。"
                                        />
                                        {table(seasonFirst.data?.rows, seasonFirstColumns, seasonFirst.isLoading, "本期还没有通关记录")}
                                    </Space>
                                )
                            },
                            {
                                key: "runs",
                                label: "全部记录",
                                children: table(allRuns.data?.rows, allRunColumns, allRuns.isLoading, "还没有任何挑战记录")
                            }
                        ]}
                    />
                </Card>
            )}
        </Space>
    )
}
