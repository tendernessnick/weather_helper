# 持久化数据库的自动备份与恢复

本项目的 CloudBase 个人共享 PostgreSQL 通过受限服务端 RPC 保存业务数据。应用容器中的 SQLite 是可重建缓存。定期备份由后台协调器导出与远端 PostgreSQL **同一 revision** 的完整 SQLite 快照，再加密保存至私有对象存储。重新部署后的正常启动应从 PostgreSQL 重建缓存；备份用于误删、数据损坏或迁移恢复。

## 自动备份

调度器每小时检查一次；距离最近一个云端已验证备份满 24 小时才创建下一份。成功状态保存在不可变的云端 `.verified.json` 回执中，容器重启不会重置备份时钟。失败会进入现有管理员调度任务状态，并在下次检查时重试。

每次备份依次执行：

1. 后台协调器持有写锁，核对本地缓存与 PostgreSQL revision，通过 SQLite online backup API 导出快照，再核对远端 revision。不能直接复制活跃数据库文件。
2. 验证 SQLite `integrity_check`、12 张表、列和球场引用；按主键顺序计算每表所有列的 SHA-256，同时记录行数、关键时间范围和球场分布。
3. ZIP 压缩数据库与清单，使用随机 nonce 的 AES-256-GCM 认证加密。密钥仅存在于服务端环境和独立的本地密钥备份中。
4. 临发送前向官方接口申请短期上传签名，再用 raw PUT 上传私有桶（上传 token 不保存、不记录）；立即下载密文，核对 SHA-256，验证 GCM、ZIP、数据库完整性及逐表 SHA。全部通过后才写成功回执。
5. 默认保留最近 **30 个已验证版本**，删除更早的本格式备份。原有部署前保全备份位于其他前缀，自动清理不会触及。失败或中断的无回执文件也不会触发旧备份清理，需要运维检查后手动处理。

日常副本的恢复点间隔约 24 小时；数据库正常在线写入仍以外部 PostgreSQL 为准。该备份不等于平台的任意时间点恢复。天气原始数据的 `DATA_RETENTION_DAYS` 默认 `0`，表示不自动按天数删除；如以后显式设为正数则按该天数清理。评分展示仍可使用自己的滚动统计窗口。备份默认保留 30 个版本，长期数据量增长时需要相应核对数据库及对象存储用量。

## 服务端配置

所有凭据均通过受保护的环境变量配置，不能写入 Git、前端构建变量、截图或普通日志。

| 变量 | 用途/默认值 |
|---|---|
| `BACKUP_ENABLED` | 显式设为 `true` 才启用自动备份 |
| `BACKUP_MODE` | 线上使用 `cloudbase_http` |
| `BACKUP_ENCRYPTION_KEY` | 32 字节密钥的标准 Base64；应单独离线保留 |
| `BACKUP_STORAGE_URL` | 可选；默认复用 `PERSISTENCE_API_URL` 的 HTTPS 网关源地址 |
| `BACKUP_STORAGE_TOKEN` | 可选；默认复用 `PERSISTENCE_API_KEY`，以 Bearer 认证 |
| `BACKUP_STORAGE_BUCKET` | 默认 `weather-helper-backups`，必须为私有桶 |
| `BACKUP_RETENTION_COUNT` | 默认 `30`，最小 2 |
| `BACKUP_INTERVAL_SECONDS` | 默认 `86400`，与每小时检查频率分别控制 |
| `DATABASE_SCHEMA` | 默认 `weather_helper`，用于备份命名空间 |

CloudBase 的 `service_role` 密钥会绕过环境 RLS，必须只用于受控服务端；它不是匿名可发布的 key。不要把本机 CloudBase CLI 的账户登录 token 配到应用。若后续使用单独备份身份，应把 RLS 限制到专用桶及对应前缀。

线上 HTTP 方案不依赖 PostgreSQL TCP 公网地址，也不依赖容器安装 `pg_dump`。脚本仍保留 PostgreSQL 协议环境的可选 `BACKUP_MODE=postgresql` 工具，只有确实存在协议入口并安装兼容的 `pg_dump`/`pg_restore` 时才可使用。

## 手动备份

在后端环境中（凭据已经通过环境变量配置）运行：

```powershell
.venv\Scripts\python.exe scripts\pg_backup.py backup --force
```

线上 Linux 容器使用 `.venv/bin/python scripts/pg_backup.py backup --force`。后台定时任务复用已初始化的协调器，在短时写锁内导出缓存。独立 CLI 则从远端分页重建只读缓存，并在每页及最后核对 revision；不会抢占运行中应用的写租约。如果下载期间天气入库使 revision 改变，本次会失败，可在更新完成后重试；不会把不一致的数据标记为成功备份。

## 恢复演练

先把私密环境变量注入受控终端；下列命令不在参数中包含任何密钥。`object_key` 从管理员状态或备份成功回执读取，是以 `weather-pg-http-v1/weather_helper/` 开头的对象键。

```powershell
.venv\Scripts\python.exe scripts\pg_backup.py download <object_key> C:\private\backup.aes256gcm
.venv\Scripts\python.exe scripts\pg_backup.py decrypt C:\private\backup.aes256gcm C:\private\backup.zip
.venv\Scripts\python.exe scripts\pg_backup.py inspect C:\private\backup.zip
.venv\Scripts\python.exe scripts\pg_backup.py restore-local C:\private\backup.zip C:\private\recovery-drill.db
```

`restore-local` 仅接受不存在的目标文件，先完成 GCM/归档校验，再验证恢复后文件哈希与 12 张表完整摘要。报告只输出时间、revision 和行数，不输出用户记录或订阅密钥。原数据库不受影响。

演练通过的 SQLite 文件是完整的业务数据源，真正恢复至 PostgreSQL 时仍需在维护窗口中停写、使用迁移工具导入隔离目标、对照摘要，再切换应用。不能直接覆盖正在运行的 SQLite 缓存，更不能只回退镜像而忽略数据版本。

密文信封格式是 `WHPG1\0`、12 字节 nonce、密文和 16 字节 GCM tag；格式头作为额外认证数据。HTTP 备份解密后包含固定成员 `weather.db` 与 `manifest.json`，与此前部署前保全的 `WHBK1` 备份格式区分。密钥轮换前须另存旧密钥；已有备份不会自动重新加密。

## 运维检查

管理员应查看 `database_backup` 的 `last_ok`/`last_error` 及备份服务状态。每次部署至少检查一次最新成功回执；每月抽取一份实际恢复演练。若超过 48 小时没有成功备份，应排查服务端 key、私有桶、磁盘临时空间、协调器 revision/租约及网络。当前没有额外购买短信/邮件告警服务。

HTTP 和权限依据：[CloudBase PG Storage HTTP API](https://docs.cloudbase.net/en/http-api/storage-pg/pg-storage-api)、[PG 模式云存储](https://docs.cloudbase.net/storage/pg/introduce)。
