# 历史数据迁移与持久化验收

本次保留现有 CloudBase 个人版，使用共享 PostgreSQL 的 HTTP 接口保存 12 张原生业务表；应用容器中的 SQLite 是可重建查询缓存。没有升级套餐或购买新的数据库实例。数据库、网络和备份仍计入原有环境用量。

## 已完成的验收

| 检查 | 结果与证据 |
|---|---|
| 最终停写快照 | 2026-11-14 15:28:53 UTC，473,357 行；AES-GCM 私有云副本、本机副本及 SQLite 完整性通过 |
| 正式迁移 | 12 表所有列、原始 ID、香港时间与源快照逐值 SHA 一致；[完整迁移报告](history-import-verification.json) |
| 首次上线 | `weather-helper-006` 通过 HTTP 写入 PG；历史行数未减少，气候排名与旧站完全一致；[切换检查](first-cutover-verification.json) |
| 全新容器重部署 | `006 → 007` 重新从 PG 构建缓存，12 表行数未减少，并取得第 7 代写租约；[重部署检查](redeploy-verification.json) |
| 自动备份 | 正式调度任务成功，备份 revision 130；独立下载 14,116,585 字节密文并完整恢复，12 表逐值 SHA 一致；[正式恢复演练](live-backup-restore.json) |
| 云存储访问 | 私有桶，匿名访问拒绝；实际大文件上传、下载与新格式回执验证通过；[存储预检](storage-preflight-verification.json) |
| 持续回归 | 本机真实 PG 和 GitHub CI 均通过，后端 230 项；另含前端与 Chromium 浏览器回归 |

源快照 SHA-256：`1cd3aeb72b0cc0de56fd24afabf6f8a8e5fb25c27c6018e93fbdb4dd1290efab`。迁移和恢复报告只包含摘要、计数与时间范围，数据库原件、解密密钥、服务端 key 和签名 URL 均不入库。

## 日常运行

- 天气原始历史默认不按天数自动删除（`DATA_RETENTION_DAYS=0`）；评分继续使用自己的滚动窗口。
- 自动任务每小时检查备份是否到期，满 24 小时创建一次完整加密备份，保留最近 30 个已验证版本。容器重启后从云端回执恢复备份时钟。
- 发布采用 `0% → 100%` 切换。候选版本确认已接到流量后才接管更高代号的数据库租约，零流量旧实例不能继续写入。
- GitHub push 触发 CloudBase 发布；后端 key 与配置保存在 CloudBase 运行环境，前端不连接管理员数据接口。
- 新容器需要短暂重建缓存。`/api/health` 报告同步状态，期间业务请求可能返回可重试的 503；完成后 `cache_valid`、`leader` 和 `traffic_confirmed` 应为 `true`。

详细部署与回退约束见 [HTTP 持久化说明](../PERSISTENCE_HTTP.md)，备份配置与独立恢复命令见 [备份说明](../PERSISTENCE_BACKUPS.md)。备份标签 `weather-helper-before-persistence-20261114` 保留改造前的代码状态。
