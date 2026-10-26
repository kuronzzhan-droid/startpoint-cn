import { useState } from "react"
import { Alert, Button, Card, Descriptions, Modal, Popconfirm, Space, Tag, Typography, Upload, message } from "antd"
import { DatabaseOutlined, DeleteOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiDelete, apiGet, apiPost, apiUpload } from "../api/client"
import { AdminPage } from "../components/AdminPage"
import { useAdminEditGuard } from "../lib/editGuard"
import { formatBeijingTime } from "../lib/adminFormat"

interface DefaultSaveMeta {
    exists: boolean; playerName?: string | null; exportedAt?: string | null; sourcePlayerId?: number | null
    version?: number | null; scope?: string | null; includedTableCount?: number | null; rowCount?: number | null
    status?: "absent" | "valid" | "recovered" | "cleared" | "invalid"; error?: string; warning?: string
}
interface DatabaseBackupResult {
    ok: boolean; backup: string; retainedBackups: number; removedBackups: number; backupCleanupError: string | null
}

export default function DataMaintenance() {
    const qc = useQueryClient()
    const [backup, setBackup] = useState<DatabaseBackupResult>()
    const [templateFile, setTemplateFile] = useState<File | null>(null)
    const { data: defSave, isPending: defaultLoading, isError: defaultError, isFetching: defaultFetching, refetch: retryDefault } = useQuery({
        queryKey: ["defaultSave"], queryFn: ({ signal }) => apiGet<DefaultSaveMeta>("/api/server/defaultSave", { signal }),
    })
    const uploadDefault = useMutation({
        mutationFn: (file: File) => apiUpload("/api/server/defaultSave", file),
        onSuccess: () => { void message.success("默认存档已设置"); setTemplateFile(null); void qc.invalidateQueries({ queryKey: ["defaultSave"] }) },
        onError: (error: Error) => { void message.error(error.message) },
    })
    const clearDefault = useMutation({
        mutationFn: () => apiDelete("/api/server/defaultSave"),
        onSuccess: () => { void message.success("默认存档已清除"); void qc.invalidateQueries({ queryKey: ["defaultSave"] }) },
        onError: (error: Error) => { void message.error(error.message) },
    })
    const createDatabaseBackup = useMutation({
        mutationFn: () => apiPost<DatabaseBackupResult>("/api/server/databaseBackup"),
        onSuccess: result => { setBackup(result); void message.success("完整数据库备份已创建") },
        onError: (error: Error) => { void message.error(`数据库备份失败：${error.message}`) },
    })
    const defaultWritesDisabled = defaultLoading || defaultError || uploadDefault.isPending || clearDefault.isPending
    useAdminEditGuard({ dirty: !!templateFile, pending: uploadDefault.isPending || clearDefault.isPending || createDatabaseBackup.isPending, label: "存档与备份" })
    return <AdminPage eyebrow="MAINTENANCE" title="存档与备份" description="备份当前数据库，或设置新建存档使用的模板。"
        actions={<Button icon={<ReloadOutlined />} loading={defaultFetching} onClick={() => void retryDefault()}>刷新</Button>}>
        <Space direction="vertical" size="large" className="admin-stack">
            <Card title="完整数据库备份" extra={<Button type="primary" icon={<DatabaseOutlined />} loading={createDatabaseBackup.isPending}
                onClick={() => createDatabaseBackup.mutate()}>创建完整备份</Button>}>
                <Space direction="vertical" className="admin-stack">
                    <Typography.Text>可在服务器运行时备份数据库，保留最近 5 份手动备份。</Typography.Text>
                    <Typography.Text type="secondary">备份保存在服务器上；默认存档模板、公告文件、资源包和种子学习文件需另行保管。</Typography.Text>
                    {backup && <Alert type="success" showIcon message="最近成功备份" description={<Space direction="vertical" className="admin-stack">
                        <Typography.Text copyable style={{ overflowWrap: "anywhere" }}>{backup.backup}</Typography.Text>
                        <Typography.Text>最多保留 {backup.retainedBackups} 份；本次清理旧备份 {backup.removedBackups} 份。</Typography.Text>
                    </Space>} />}
                    {backup?.backupCleanupError && <Alert type="warning" showIcon message="新备份已保留，旧备份清理未完成" description={backup.backupCleanupError} />}
                </Space>
            </Card>
            <Card title="默认存档" loading={defaultLoading}>
                <Space direction="vertical" className="admin-stack">
                    <Typography.Text>新建存档时使用的玩家数据模板。请上传玩家详情页导出的完整 JSON 存档。</Typography.Text>
                    {defaultError ? <Alert type="error" showIcon message="默认存档读取失败" description="模板状态未知，暂时禁止修改。"
                        action={<Button loading={defaultFetching} onClick={() => void retryDefault()}>重试默认存档</Button>} />
                        : defSave?.status === "invalid" ? <Alert type="error" showIcon message="默认存档损坏或不受支持"
                            description={<>{defSave.error}<br />新建存档已暂停，请重新上传有效模板或清除模板。</>} /> : defSave?.exists ? <>
                        <Space wrap><Tag color="green">已设置</Tag><Tag color={defSave.version === 2 ? "blue" : "orange"}>
                            {defSave.version === 2 ? "完整存档 V2" : `旧版 V${defSave.version ?? "?"}（部分数据）`}</Tag></Space>
                        <Descriptions size="small" column={1}>
                            <Descriptions.Item label="模板玩家">{defSave.playerName || "—"}</Descriptions.Item>
                            <Descriptions.Item label="导出时间（北京时间）">{formatBeijingTime(defSave.exportedAt)}</Descriptions.Item>
                            {defSave.version === 2 && defSave.rowCount != null && <Descriptions.Item label="数据范围">{defSave.includedTableCount ?? "—"} 张表 / {defSave.rowCount} 行</Descriptions.Item>}
                        </Descriptions>
                    </> : <Tag>未设置，新建时使用空存档</Tag>}
                    {defSave?.warning && <Alert type="warning" showIcon message="已使用模板备份" description={defSave.warning} />}
                    <Typography.Text type="secondary">模板用于后续新建存档。邮箱、领取历史、设备会话和跨玩家关系不会复制。</Typography.Text>
                    <Space wrap>
                        <Upload showUploadList={false} accept=".json" disabled={defaultWritesDisabled}
                            beforeUpload={file => { setTemplateFile(file); return false }}>
                            <Button icon={<UploadOutlined />} loading={uploadDefault.isPending} disabled={defaultWritesDisabled}>
                                {defSave?.exists ? "替换默认存档" : "上传默认存档"}</Button>
                        </Upload>
                        {defSave?.exists && <Popconfirm title="清除默认存档？" description="之后新建存档将使用空档，当前已有存档保持原样。"
                            onConfirm={() => clearDefault.mutate()} okText="确认清除" cancelText="取消" okButtonProps={{ danger: true, disabled: defaultWritesDisabled }}>
                            <Button danger icon={<DeleteOutlined />} loading={clearDefault.isPending} disabled={defaultWritesDisabled}>清除默认存档</Button>
                        </Popconfirm>}
                    </Space>
                </Space>
            </Card>
        </Space>
        <Modal title={defSave?.exists ? "替换默认存档模板？" : "设置默认存档模板？"} open={!!templateFile}
            onCancel={() => { if (!uploadDefault.isPending) setTemplateFile(null) }}
            onOk={() => { if (templateFile && !defaultWritesDisabled) uploadDefault.mutate(templateFile) }}
            okText="确认使用此模板" cancelText="取消" confirmLoading={uploadDefault.isPending}
            okButtonProps={{ disabled: defaultWritesDisabled }} cancelButtonProps={{ disabled: uploadDefault.isPending }} maskClosable={false}>
            <Typography.Paragraph style={{ overflowWrap: "anywhere" }}>文件：{templateFile?.name}</Typography.Paragraph>
            <Typography.Paragraph>用于之后的新建存档，当前已有玩家存档保持原样。</Typography.Paragraph>
        </Modal>
    </AdminPage>
}
