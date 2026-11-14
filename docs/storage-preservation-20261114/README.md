# 历史数据保留验收 · 2026-11-14

## 结果

线上 SQLite 已通过 Online Backup API 生成一致性快照，完成容器外保全：**本机有完整可读备份及独立恢复副本，CloudBase 私有存储桶有 AES-256-GCM 加密副本**。密钥单独下载并保存在本机，没有上传云存储或提交 Git。

本轮未发布或重启 Weather Helper，未更改应用环境变量、挂载卷或实例配置，也未迁移业务数据库。仅为备份新建了私有存储桶；这不代表业务数据已经实现自动持久化。

## 已执行验证

快照时间：**2026-11-14 12:05:54 UTC / 20:05:54 香港时间**。

| 检查 | 结果 |
|---|---|
| 数据库大小 | 131,035,136字节 |
| 密文大小 | 18,154,466字节 |
| 在线快照完整性 | `PRAGMA integrity_check = ok` |
| 传输及解密 | 密文SHA256、AES-GCM认证、解密ZIP SHA256均匹配 |
| 压缩包与数据库 | ZIP CRC通过，解压后数据库SHA256匹配云端manifest |
| 数据核对 | 12张表行数、主要时间范围与云端快照manifest一致 |
| 恢复演练 | 恢复到另一独立SQLite文件，完整性与12张表行数一致 |
| 云端访问 | 私有桶`public=false`；认证下载HTTP200；匿名请求HTTP404，未返回备份 |

| 表 | 行数 |
|---|---:|
| courts | 57 |
| forecast_snapshots | 47,196 |
| observations | 44,232 |
| nowcast_snapshots | 182,229 |
| forecast_leads | 180,374 |
| climatology | 16,416 |
| persistence | 684 |
| kv_cache | 60 |
| user_reports / checkins / push_subscriptions / feedback | 各0 |

完整无密钥验收摘要见 [verification-summary.json](verification-summary.json)。预报/观测/临近预报的历史从2026-10-13起；未来目标小时属于当时保存的预报，不是未来观测记录。

## 文件位置与恢复

本机完整备份位于：

```text
F:/AICoding/_backups/weather-helper-cloudbase-before-update-20261114/
```

其中`verified-snapshot-20261114T120554Z/weather.db`是已验证原始快照，`restore-drill-20261114T120554Z.db`是恢复演练副本；本机备份目录内的README记录密钥、密文和恢复格式。服务配置、临时凭证、密钥、数据库及完整压缩包均不进入本仓库。

云端密文存储在当前环境私有桶`weather-helper-backups`。解密密钥与云端密文分开保管；恢复后必须再次检查文件摘要与数据库完整性。

**这是一份时间点快照。原服务仍在继续采集，快照之后产生的数据不包含在本次备份中。** 正式迁移或部署前需再做最终快照/增量同步，并明确切换时间，不能直接用旧快照覆盖仍在写入的主库。

## 导出方式与后续选择

WebShell的File Download实测只允许约10KB文件，无法下载完整数据库；CLI的`--json`下载模式只输出响应元信息，也不写本地文件。本次使用容器在线快照、流式AES加密、单对象限时签名上传，再用CLI普通下载模式取回。

下一步优先评估**本环境已有的共享PostgreSQL**。需要核对其真实协议连接入口、兼容改造及增量费用；如果仅有HTTP数据API，则需重构数据访问层。CFS/NFS上直接运行SQLite不作为默认推荐。具体研究和迁移清单见 [research.md](research.md)。

尚未实施自动定时备份、自动恢复或PostgreSQL迁移。代码优化版也尚未发布到CloudBase。
