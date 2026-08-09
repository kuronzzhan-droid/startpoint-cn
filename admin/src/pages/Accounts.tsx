import { useEffect, useRef, useState } from "react"
import { Alert, Card, Table, Button, Space, Popconfirm, Input, message, Tag, Typography, Upload, Modal, Drawer, Progress } from "antd"
import { PlusOutlined, CopyOutlined, DeleteOutlined, SwapOutlined, EditOutlined, DownloadOutlined, UploadOutlined } from "@ant-design/icons"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { apiGet, apiPost, apiUpload } from "../api/client"
import { AdminPage } from "../components/AdminPage"

interface AccountRow {
    id: number
    viewerId: string | null
    bindings: DeviceBinding[]
    saveCount: number
    defaultPlayerId: number | null
    defaultPlayerName: string | null
    activePlayerId: number | null
    players: PlayerBrief[]
    playerIds: number[]
}

interface DeviceBinding {
    deviceId: number
    note: string | null
}

interface PlayerBrief {
    id: number
    accountId: number
    name: string
    comment: string
    degreeId: number
    isDefault: boolean
    isActive: boolean
}

interface CleanupJob {
    ok: boolean
    jobId?: string
    status: "idle" | "running" | "completed" | "failed"
    phase?: "preparing" | "backing_up" | "indexing" | "deleting" | "finalizing"
    totalAccounts?: number
    processedAccounts?: number
    deletedAccounts: number
    deletedSaves: number
    skippedActiveAccount: number | null
    backup: string | null
    removedBackups: number
    backupCleanupError: string | null
    createdIndexes?: number
    workerThreadId?: number | null
    error?: string | null
}

const REPORTED_CLEANUP_JOB_STORAGE_KEY = "admin:unnoted-account-cleanup:last-reported-job"

function readReportedCleanupJob(): string | null {
    if (typeof window === "undefined") return null
    try {
        return window.localStorage.getItem(REPORTED_CLEANUP_JOB_STORAGE_KEY)
    } catch {
        return null
    }
}

function rememberReportedCleanupJob(jobId: string) {
    if (typeof window === "undefined") return
    try {
        window.localStorage.setItem(REPORTED_CLEANUP_JOB_STORAGE_KEY, jobId)
    } catch {
        // The in-memory ref still prevents duplicates during this mount.
    }
}

export default function Accounts() {
    const qc = useQueryClient()
    const navigate = useNavigate()
    const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
    const [renameId, setRenameId] = useState<number | null>(null)
    const [renameName, setRenameName] = useState("")
    const [accountQuery, setAccountQuery] = useState("")
    const [editNoteDeviceId, setEditNoteDeviceId] = useState<number | null>(null)
    const [editNote, setEditNote] = useState("")
    const reportedCleanupJob = useRef<string | null>(readReportedCleanupJob())

    const { data: accounts = [], isLoading } = useQuery({
        queryKey: ["accounts"],
        queryFn: () => apiGet<AccountRow[]>("/api/server/accounts"),
    })
    const { data: cleanupJob } = useQuery({
        queryKey: ["unnoted-account-cleanup"],
        queryFn: () => apiGet<CleanupJob>("/api/server/deleteUnnotedAccounts/status"),
        refetchInterval: query =>
            (query.state.data as CleanupJob | undefined)?.status === "running" ? 1000 : false,
    })

    const selectedAccount = accounts.find(a => a.id === selectedAccountId)
    const savePlayers = selectedAccount?.players ?? []
    const normalizedQuery = accountQuery.trim().toLowerCase()
    const filteredAccounts = normalizedQuery
        ? accounts.filter(account => [
            account.id,
            account.viewerId,
            ...account.bindings.flatMap(binding => [binding.deviceId, binding.note]),
            ...account.players.flatMap(player => [player.id, player.name, player.comment]),
        ].filter(value => value != null).join(" ").toLowerCase().includes(normalizedQuery))
        : accounts
    const unnotedAccounts = accounts.filter(account =>
        !account.bindings.some(binding => typeof binding.note === "string" && binding.note.trim().length > 0)
        && !account.players.some(player => player.isActive),
    )
    const unnotedSaveCount = unnotedAccounts.reduce((count, account) => count + account.saveCount, 0)
    const activeUnnotedAccount = accounts.find(account =>
        account.players.some(player => player.isActive)
        && !account.bindings.some(binding => typeof binding.note === "string" && binding.note.trim().length > 0),
    )

    const refresh = () => {
        qc.invalidateQueries({ queryKey: ["accounts"] })
    }

    const activateSave = useMutation({
        mutationFn: (playerId: number) => apiPost("/api/server/activateSave?playerId=" + playerId),
        onSuccess: () => { message.success("已切换生效存档"); refresh() },
    })

    const newSave = useMutation({
        mutationFn: (accountId: number) => apiPost("/api/server/newSave?accountId=" + accountId),
        onSuccess: () => { message.success("新存档已创建"); refresh() },
    })

    const deleteSave = useMutation({
        mutationFn: (playerId: number) => apiPost("/api/server/deleteSave?playerId=" + playerId),
        onSuccess: () => { message.success("存档已删除"); refresh() },
    })

    const deleteAccount = useMutation({
        mutationFn: (id: number) => apiPost("/api/server/deleteAccount?id=" + id),
        onSuccess: () => {
            message.success("账号已删除")
            if (selectedAccountId === (deleteAccount.variables as number)) setSelectedAccountId(null)
            refresh()
        },
    })

    const renameSave = useMutation({
        mutationFn: ({ playerId, name }: { playerId: number; name: string }) =>
            apiPost("/api/server/renameSave", { playerId, name }),
        onSuccess: () => { message.success("已改名"); setRenameId(null); refresh() },
    })

    const cloneSave = useMutation({
        mutationFn: ({ playerId, accountId }: { playerId: number; accountId: number }) =>
            apiPost(`/api/server/cloneSave?playerId=${playerId}&accountId=${accountId}`),
        onSuccess: () => { message.success("存档已复制"); refresh() },
    })

    const renameDevice = useMutation({
        mutationFn: ({ deviceId, note }: { deviceId: number; note: string }) =>
            apiPost("/api/server/device/rename", { device_id: deviceId, name: note.trim() }),
        onSuccess: () => {
            message.success("备注已保存")
            setEditNoteDeviceId(null)
            refresh()
        },
        onError: (error: Error) => message.error(error.message),
    })

    const importSave = useMutation({
        mutationFn: ({ playerId, file }: { playerId: number; file: File }) =>
            apiUpload<{ ok: boolean }>(`/api/player/save?id=${playerId}`, file),
        onSuccess: (_, { playerId }) => {
            message.success(`存档 #${playerId} 已导入`)
            refresh()
        },
        onError: (error: Error) => message.error(error.message),
    })

    const cleanupUnnotedAccounts = useMutation({
        mutationFn: () => apiPost<CleanupJob>("/api/server/deleteUnnotedAccounts", {
            confirm: "DELETE_UNNOTED_ACCOUNTS",
        }),
        onSuccess: job => {
            qc.setQueryData(["unnoted-account-cleanup"], job)
            message.info(job.status === "running"
                ? "后台清理已启动；可以继续使用管理面板和游戏服务"
                : "没有需要清理的未备注账号")
        },
        onError: (error: Error) => message.error(error.message),
    })

    useEffect(() => {
        if (!cleanupJob?.jobId || cleanupJob.status === "idle" || cleanupJob.status === "running") return
        if (reportedCleanupJob.current === cleanupJob.jobId) return
        reportedCleanupJob.current = cleanupJob.jobId
        rememberReportedCleanupJob(cleanupJob.jobId)
        if (cleanupJob.status === "completed") {
            setSelectedAccountId(null)
            message.success(
                `后台清理完成：已删除 ${cleanupJob.deletedAccounts} 个未备注账号和 ${cleanupJob.deletedSaves} 个存档`
                + (cleanupJob.backup ? `；备份：${cleanupJob.backup}` : "")
                + (cleanupJob.removedBackups ? `；已清理 ${cleanupJob.removedBackups} 个旧备份` : ""),
                10,
            )
            if (cleanupJob.backupCleanupError) {
                message.warning(`新备份已保留，但旧备份清理失败：${cleanupJob.backupCleanupError}`, 10)
            }
            qc.invalidateQueries({ queryKey: ["accounts"] })
        } else {
            message.error(`后台清理失败：${cleanupJob.error ?? "未知错误"}；已完成的批次不会自动恢复`, 10)
        }
    }, [cleanupJob, qc])

    const cleanupRunning = cleanupJob?.status === "running"
    const cleanupPercent = cleanupRunning && cleanupJob.totalAccounts
        ? Math.round(((cleanupJob.processedAccounts ?? 0) / cleanupJob.totalAccounts) * 100)
        : 0
    const cleanupPhaseText = {
        preparing: "正在准备 Worker",
        backing_up: "正在创建完整数据库备份",
        indexing: "正在检查删除索引",
        deleting: "正在分批删除",
        finalizing: "正在写入结果并清理旧备份",
    }[cleanupJob?.phase ?? "preparing"]

    const confirmCleanupUnnotedAccounts = () => {
        Modal.confirm({
            title: `删除 ${unnotedAccounts.length} 个未备注账号？`,
            content: (
                <Space direction="vertical" size="small">
                    <Typography.Text>
                        将同时删除这些账号下的 {unnotedSaveCount} 个存档。空备注、纯空格备注和无设备绑定都视为未备注。
                    </Typography.Text>
                    <Typography.Text type="warning">
                        当前活动账号会自动保留；执行前服务端会创建完整数据库备份。
                    </Typography.Text>
                    <Typography.Text type="secondary">
                        清理由独立 Worker 分批执行，期间可以继续登录和游戏；涉及数据库写入的操作偶尔可能短暂停顿。
                    </Typography.Text>
                    <Typography.Text type="secondary">
                        新备份和清理均成功后，只保留本次清理备份，较早的同类自动备份会被删除。
                    </Typography.Text>
                    <Typography.Text type="danger">删除后无法在面板内撤销。</Typography.Text>
                </Space>
            ),
            okText: "确认删除并备份",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await cleanupUnnotedAccounts.mutateAsync()
                } catch {
                    // 错误信息由 mutation 统一展示。
                }
            },
        })
    }

    const confirmImportSave = (player: PlayerBrief, file: File) => {
        Modal.confirm({
            title: `确认覆盖存档 #${player.id}？`,
            content: `将使用“${file.name}”完整覆盖“${player.name}”的当前存档数据。建议先导出备份，此操作无法在面板内撤销。`,
            okText: "确认覆盖",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await importSave.mutateAsync({ playerId: player.id, file })
                } catch {
                    // 错误信息由 mutation 统一展示。
                }
            },
        })
        return Upload.LIST_IGNORE
    }

    const accountColumns = [
        {
            title: "账号 ID（viewer_id）",
            dataIndex: "viewerId",
            width: 170,
            render: (viewerId: string | null) => viewerId
                ? <Typography.Text copyable={{ text: viewerId }}>{viewerId}</Typography.Text>
                : <Typography.Text type="secondary">未生成</Typography.Text>,
        },
        {
            title: "设备 ID",
            width: 120,
            responsive: ["sm"] as any,
            render: (_: unknown, row: AccountRow) => row.bindings.length
                ? row.bindings.map(binding => <div key={binding.deviceId}>{binding.deviceId}</div>)
                : <Typography.Text type="secondary">未绑定</Typography.Text>,
        },
        {
            title: "备注",
            width: 250,
            render: (_: unknown, row: AccountRow) => row.bindings.length
                ? row.bindings.map(binding => (
                    <div key={binding.deviceId}>
                        {editNoteDeviceId === binding.deviceId ? (
                            <Space.Compact>
                                <Input
                                    size="small"
                                    value={editNote}
                                    maxLength={100}
                                    placeholder="输入账号备注"
                                    onChange={event => setEditNote(event.target.value)}
                                    onPressEnter={() => renameDevice.mutate({ deviceId: binding.deviceId, note: editNote })}
                                    style={{ width: 150 }}
                                />
                                <Button
                                    size="small"
                                    type="primary"
                                    loading={renameDevice.isPending}
                                    onClick={() => renameDevice.mutate({ deviceId: binding.deviceId, note: editNote })}
                                >
                                    保存
                                </Button>
                                <Button size="small" onClick={() => setEditNoteDeviceId(null)}>取消</Button>
                            </Space.Compact>
                        ) : (
                            <Space size={4}>
                                {binding.note
                                    ? <span>{binding.note}</span>
                                    : <Typography.Text type="secondary">未填写</Typography.Text>}
                                <Button
                                    type="text"
                                    size="small"
                                    aria-label={`编辑设备 ${binding.deviceId} 的备注`}
                                    icon={<EditOutlined />}
                                    onClick={() => {
                                        setEditNoteDeviceId(binding.deviceId)
                                        setEditNote(binding.note ?? "")
                                    }}
                                />
                            </Space>
                        )}
                    </div>
                ))
                : <Typography.Text type="secondary">无设备绑定</Typography.Text>,
        },
        { title: "内部 ID", dataIndex: "id", width: 80, responsive: ["lg"] as any },
        { title: "存档数", dataIndex: "saveCount", width: 80, responsive: ["sm"] as any },
        {
            title: "默认存档", width: 180, responsive: ["md"] as any,
            render: (_: unknown, row: AccountRow) => {
                if (!row.defaultPlayerId) return <Tag>无</Tag>
                const isActive = row.activePlayerId === row.defaultPlayerId
                return (
                    <Space size={6} wrap>
                        <span>{row.defaultPlayerName ?? `#${row.defaultPlayerId}`}</span>
                        <Tag color={isActive ? "green" : "blue"}>{isActive ? "当前活动" : "账号默认"}</Tag>
                    </Space>
                )
            },
        },
        {
            title: "操作", width: 250,
            render: (_: unknown, row: AccountRow) => (
                <div className="admin-action-row">
                    <Button size="small" type="primary" onClick={() => setSelectedAccountId(row.id)}>管理存档</Button>
                    <Button size="small" icon={<PlusOutlined />} onClick={() => newSave.mutate(row.id)}>新建存档</Button>
                    <Popconfirm title={`删除账号 ${row.id} 及所有存档？`} onConfirm={() => deleteAccount.mutate(row.id)} okText="确认" cancelText="取消" okButtonProps={{ danger: true }}>
                        <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                </div>
            ),
        },
    ]

    const saveColumns = [
        { title: "ID", dataIndex: "id", width: 60, responsive: ["sm"] as any },
        {
            title: "名字", width: 150,
            render: (_: unknown, row: PlayerBrief) => renameId === row.id ? (
                <div className="admin-edit-compact">
                    <Input size="small" value={renameName} onChange={e => setRenameName(e.target.value)} onPressEnter={() => renameSave.mutate({ playerId: row.id, name: renameName })} style={{ width: 100 }} />
                    <Button size="small" type="primary" onClick={() => renameSave.mutate({ playerId: row.id, name: renameName })}>确定</Button>
                    <Button size="small" onClick={() => setRenameId(null)}>取消</Button>
                </div>
            ) : (
                <Space>
                    <a onClick={() => navigate(`/players/${row.id}`)}>{row.name}</a>
                    <Button type="text" size="small" icon={<EditOutlined />} onClick={() => { setRenameId(row.id); setRenameName(row.name) }} />
                </Space>
            ),
        },
        { title: "等级", width: 80, responsive: ["md"] as any, render: (_: unknown, row: PlayerBrief) => `Lv.${row.degreeId || 1}` },
        {
            title: "状态", width: 80, responsive: ["sm"] as any,
            render: (_: unknown, row: PlayerBrief) => (
                <Space size={4} wrap>
                    {row.isDefault && <Tag color="blue">账号默认</Tag>}
                    {row.isActive && <Tag color="green">当前活动</Tag>}
                </Space>
            ),
        },
        {
            title: "操作", width: 430,
            render: (_: unknown, row: PlayerBrief) => (
                <div className="admin-action-row">
                    <Button size="small" icon={<SwapOutlined />} disabled={row.isDefault && row.isActive} onClick={() => activateSave.mutate(row.id)}>
                        设为默认并切换
                    </Button>
                    <Button size="small" icon={<CopyOutlined />} onClick={() => cloneSave.mutate({ playerId: row.id, accountId: selectedAccountId! })}>
                        复制
                    </Button>
                    <Button size="small" icon={<DownloadOutlined />} href={`/api/player/save?id=${row.id}`} target="_blank">
                        导出
                    </Button>
                    <Upload
                        accept=".json,application/json"
                        showUploadList={false}
                        maxCount={1}
                        beforeUpload={file => confirmImportSave(row, file)}
                    >
                        <Button
                            size="small"
                            danger
                            icon={<UploadOutlined />}
                            loading={importSave.isPending && importSave.variables?.playerId === row.id}
                        >
                            导入
                        </Button>
                    </Upload>
                    <Popconfirm title={`删除存档 ${row.id}？`} onConfirm={() => deleteSave.mutate(row.id)} okText="确认" cancelText="取消" okButtonProps={{ danger: true }}>
                        <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                </div>
            ),
        },
    ]

    return (
        <AdminPage
            eyebrow="SAVES"
            title="账号 / 存档"
            description="查看账号与默认存档关系。账号默认存档决定该账号登录时选用哪个存档；当前活动存档只是管理端最近切换的全局状态。"
        >
        <Space direction="vertical" size="large" className="admin-stack">
            <Alert
                type="info"
                showIcon
                message="选档状态说明"
                description="新建和复制存档会设为该账号默认并切换为当前活动；删除默认存档后，服务端会在该账号剩余存档中回退到第一个可用存档。删除最后一个存档会同时删除账号。"
            />
            <Card
                title="账号管理"
                className="admin-table-card"
                extra={(
                    <Space wrap>
                        <Button
                            danger
                            icon={<DeleteOutlined />}
                            disabled={unnotedAccounts.length === 0 || cleanupRunning}
                            loading={cleanupUnnotedAccounts.isPending}
                            onClick={confirmCleanupUnnotedAccounts}
                        >
                            {cleanupRunning
                                ? `后台清理中 (${cleanupJob.processedAccounts ?? 0}/${cleanupJob.totalAccounts ?? 0})`
                                : `删除未备注账号 (${unnotedAccounts.length})`}
                        </Button>
                        <Input.Search
                            allowClear
                            value={accountQuery}
                            onChange={event => setAccountQuery(event.target.value)}
                            placeholder="搜索账号 ID、设备 ID、备注或存档"
                            style={{ width: 300, maxWidth: "65vw" }}
                        />
                    </Space>
                )}
            >
                {cleanupRunning && (
                    <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 12 }}
                        message={`${cleanupPhaseText}（Worker #${cleanupJob.workerThreadId ?? "启动中"}）`}
                        description={(
                            <Space direction="vertical" style={{ width: "100%" }} size={4}>
                                <Typography.Text>
                                    已处理 {cleanupJob.processedAccounts ?? 0}/{cleanupJob.totalAccounts ?? 0} 个账号，
                                    已删除 {cleanupJob.deletedAccounts ?? 0} 个账号和 {cleanupJob.deletedSaves ?? 0} 个存档。
                                </Typography.Text>
                                <Progress percent={cleanupPercent} status="active" size="small" />
                            </Space>
                        )}
                    />
                )}
                {activeUnnotedAccount && (
                    <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 12 }}
                        message={`当前活动账号 ${activeUnnotedAccount.viewerId ?? `内部 #${activeUnnotedAccount.id}`} 没有备注，批量清理时会自动保留`}
                    />
                )}
                <Table
                    rowKey="id"
                    columns={accountColumns}
                    dataSource={filteredAccounts}
                    loading={isLoading}
                    pagination={{
                        defaultPageSize: 20,
                        showSizeChanger: true,
                        pageSizeOptions: [20, 50, 100],
                        showTotal: total => `共 ${total} 个账号`,
                    }}
                    size="small"
                    scroll={{ x: "max-content" }}
                />
            </Card>

            <Drawer
                open={selectedAccountId !== null}
                onClose={() => setSelectedAccountId(null)}
                width="min(1180px, 96vw)"
                title={selectedAccount
                    ? `账号 ${selectedAccount.viewerId ?? `内部 #${selectedAccount.id}`} 的存档`
                    : "存档管理"}
                destroyOnClose
            >
                {selectedAccount ? (
                    <Table
                        rowKey="id"
                        columns={saveColumns}
                        dataSource={savePlayers}
                        pagination={false}
                        size="small"
                        locale={{ emptyText: "暂无存档" }}
                        scroll={{ x: "max-content" }}
                    />
                ) : (
                    <Alert type="warning" showIcon message="账号已不存在或刚刚被删除" />
                )}
            </Drawer>

        </Space>
        </AdminPage>
    )
}
