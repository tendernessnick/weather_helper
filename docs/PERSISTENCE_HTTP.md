# CloudBase 共享 PostgreSQL 持久化

CloudBase 个人版共享实例通过 HTTPS/PostgREST 接入，不要求数据库公网端口或升级套餐。PostgreSQL 中 `weather_helper` schema 的 12 张原生业务表保存权威数据；容器内 SQLite 仅供现有 ORM 查询，可在容器重建后重新下载生成。

## 数据一致性

- 所有业务表的 INSERT/UPDATE/DELETE（含批量清理）由 SQLite 事务触发器捕获。应用将完整事务分块暂存，再通过一个 PG 事务提交；收到远端成功后才提交本地缓存并返回成功。
- PG 的全局 revision、单写租约和事务 ID 负责并发隔离与幂等。实例重叠期间只允许一个写入者。租约过期、结果不确定或本地提交失败会封锁缓存，重新从权威表恢复。
- CloudBase 可能保留零流量旧容器。候选版本先经公开的轻量 `/api/instance` 确认自己已接到服务流量，才以更高版本代号接管租约；旧版本随即被数据库围栏拒绝写入。发布使用 `0% → 100%` 切换，不将长期混合版本流量作为运行模式。
- 缓存首次构建和恢复均逐页检查同一 revision，完整表计数及最终 revision 核对后才开放查询。暂存和心跳不会改变业务 revision。
- 新容器健康探针可报告正在同步；业务 API 在缓存恢复前返回 `503` 和 `Retry-After: 5`。首次同步与滚动交接可能短时不可查询，应查看健康探针的 `persistence.cache_valid/leader/rebuilding`。
- 当前单进程、最小/最大均为 1 个应用实例。跨版本交接由租约协调。此实现没有为多个常驻读取副本提供持续增量复制，不能直接调大实例上限。

## 服务端配置

| 变量 | 线上值或用途 |
|---|---|
| `PERSISTENCE_BACKEND` | `cloudbase_http`；未知值拒绝启动 |
| `PERSISTENCE_API_URL` | 本环境 HTTPS 网关的源地址 |
| `PERSISTENCE_API_KEY` | 受保护服务端 API key，仅注入后端 |
| `PERSISTENCE_TRAFFIC_URL` | 本服务公网 `/api/instance`，用于确认正在接流量的版本 |
| `PERSISTENCE_LEASE_SECONDS` | 默认 90 秒，后台持续续租 |
| `DATABASE_URL` | `sqlite:////data/weather.db`，此模式下表示可重建缓存 |
| `DATABASE_SCHEMA` | `weather_helper` |
| `DATA_RETENTION_DAYS` | `0`，天气历史不自动按天数清理；评分仍按其滚动窗口 |

备份变量和恢复命令见 [PERSISTENCE_BACKUPS.md](PERSISTENCE_BACKUPS.md)。API key、数据库和备份解密密钥不得进入前端、仓库或诊断输出。

## 初始化与迁移

管理身份执行 `backend/scripts/sql/http_persistence.sql`，建立私有业务表、协调元数据与唯一公开函数 `public.weather_helper_sync(jsonb)`。函数撤销 PUBLIC、anon、authenticated 执行权，仅授权 service_role；它只接受固定动作和业务表、完整字段及类型，不接受任意 SQL。

先对旧 SQLite 用 online backup API 生成不可变快照并保留私有加密副本；最终切换窗口暂停旧库写入，不能同时向两个库继续采集。

```powershell
cd backend
.venv\Scripts\python.exe -m scripts.pg_http_migration `
  --source C:\private\weather.db `
  --state C:\private\import-state.json `
  --report C:\private\import-verification.json `
  --runtime-env-file C:\private\runtime-env.json
```

导入状态与固定快照绑定，断点恢复须使用同一私有 state 文件。导入进行期间应用拒绝使用部分数据库；工具逐表核对所有值、主键、行数、时间范围和 SHA 后才解除导入围栏。工具不会把不匹配的目标库覆盖成旧快照。

## 验收与回退

上线前须核对历史统计、全部表摘要、匿名访问拒绝、实际云备份恢复和全新容器重建结果。GitHub 自动发布仅应在这些检查通过后恢复。

回退镜像不能撤销数据库写入。切换后应继续以 PG 为权威；需回到 SQLite 时先停写、导出最新 PG 并验证快照，再启用旧代码，不能直接用迁移前旧文件覆盖新增历史。管理 SQL 和元数据升级也需保留幂等及已有业务数据。

版本代号只升不降。需要回退业务代码时，以更高发布编号重新发布兼容当前持久化协议及版本围栏的镜像，而不是把流量直接切给已被围栏的低编号容器。引入围栏之前的旧镜像需要单独制定维护切换方案。维护操作若需重置代号，应先停写并保留最新备份，不能在线绕开围栏。

## 持续回归

GitHub CI 运行独立 PostgreSQL 18 服务，验证 RPC 权限、租约、CAS、幂等、分块事务、迁移与缓存重建；本机可设置仅 localhost 临时库的 `PG_MIGRATION_TEST_URL` 执行同样用例。测试不使用线上凭据。
