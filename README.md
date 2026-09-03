# 网球天气助手（香港）

香港的天气预报对"未来一两小时到底下不下雨"经常不准，而网球只有室外场。
这个项目在官方预报之上做**二次评价**：按球场展示逐小时降雨预报，用户到场后可上报实况，
系统用「天文台测站实测 + 球友众包上报」双轨自动验证每个预报源在该球场的准确率，
帮你判断"这个球场的预报今天信不信"。

## 功能

- **球场列表**：全港 57 个公共网球场（54 个康文署场 LCSD 开放数据自动导入 + 海心公園、聯校運動中心、啟德體育園北斗園三处手工核实补录），A-Z 字母索引 + 中英文搜索
- **未来 2 小时降雨**：天文台 SWIRLS 网格点临近预报（每 12 分钟更新、半小时一档、精确到球场坐标）
- **逐小时降水概率**：Open-Meteo 集合预报（未来 48 小时，任意球场坐标）
- **预报可信度评分**：对每个球场，分别给「天文台临近预报」和「Open-Meteo」打分
  （准确率 / 漏报率 / 误报率 / Brier，滚动 30 天，样本 <20 显示"数据积累中"）
- **到场实况上报**：地理围栏（球场 500 米内）+ 2 小时冷却 + 每日上限 + 位移速度校验，防刷数据
- **下雨风险推送**（PWA Web Push）：预订开打前 30 分钟，若概率 ≥50% 或临近预报有雨则提醒

## 架构

```
├── backend/                Python 3.12 + FastAPI + SQLAlchemy + SQLite（自写守护线程调度器）
│   ├── app/api/            courts / reports / subscriptions 路由
│   ├── app/services/       数据抓取(HKO/Open-Meteo/LCSD)、评分引擎、防刷、推送
│   └── tests/              21 个 pytest（评分/围栏/解析逻辑）
├── frontend/               React 19 + Vite + Tailwind 4 + vite-plugin-pwa
└── Dockerfile              前后端一体镜像（单进程长驻服务）
```

## 数据源（全部免费、无需 API key）

| 用途 | 来源 | 频率 |
|---|---|---|
| 未来 2h 每 30 分钟降雨 | [HKO 网格点降雨临近预报](https://data.gov.hk/en-data/dataset/hk-hko-rss-gridded-rainfall-nowcast-in-hong-kong) | 12 分钟 |
| 实测雨量（验证真值） | [HKO 自动站过去一小时雨量](https://data.weather.gov.hk/weatherAPI/opendata/hourlyRainfall.php?lang=en)（36 站，映射到最近球场） | 15 分钟 |
| 逐小时降水概率 | [Open-Meteo](https://open-meteo.com/)（免费非商用 1 万次/天，批量坐标） | 1 小时 |
| 当前天气/警告 | HKO `rhrread` | 15 分钟 |
| 球场名称/坐标 | [LCSD 康文署开放数据](https://www.lcsd.gov.hk/datagovhk/facility/facility-tc.json) | 启动导入 |

## 快速开始

后端（默认 http://localhost:8000 ，启动时自动导入球场并抓取全部数据源）：

```bash
cd backend
uv sync
uv run uvicorn app.main:app --port 8000
```

前端开发模式（http://localhost:5173 ，已配置 /api 代理到 8000）：

```bash
cd frontend
npm install
npm run dev
```

测试：

```bash
cd backend && uv run pytest -q
```

生产模式无需单独部署前端：`npm run build` 后由后端直接托管 `frontend/dist`，
浏览器打开 http://localhost:8000 即是完整应用（PWA 可安装到手机主屏）。

## 评分方法说明

单次"预报下雨→真下了"验证不了概率数字，因此全部采用滚动窗口聚合：

- **Open-Meteo**：每小时抓取并落库预报快照；已开始的小时不再覆写，
  每个小时保留"开打前 ~1 小时那版预报"（用户决策时看到的版本），
  与该小时最近测站实测（≥0.1mm 记为下雨）比对，二分类（概率≥50% 记为预报有雨）+ Brier
- **天文台临近预报**：对每个小时取"开始前最后一次快照"，若其中落在该小时的
  30 分钟步进有 ≥0.05mm 则记为预报有雨（确定性预报，不计 Brier）
- **球友上报**：按球场+小时聚合（同设备每小时最多一票），多数决出"是否下雨"，
  作为独立于测站的第二种验证真值（能捕捉测站漏掉的局部骤雨）

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./weather.db` | 换 PostgreSQL 用 `postgresql+psycopg://...` |
| `GEOFENCE_METERS` | `500` | 上报地理围栏半径 |
| `REPORT_COOLDOWN_HOURS` | `2` | 同设备同球场冷却 |
| `DAILY_REPORT_LIMIT` | `10` | 每设备每日上报上限 |
| `MAX_SPEED_KMH` | `250` | 位移速度上限（防瞬移刷量） |
| `POP_RAIN_THRESHOLD` | `50` | 概率≥此值记为"预报有雨"；推送触发线 |
| `WINDOW_DAYS` / `MIN_SAMPLES` | `30` / `20` | 评分窗口与最小样本 |
| `VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY` | 空 | Web Push 密钥（生成：`npx web-push generate-vapid-keys`） |
| `CORS_ORIGINS` | `*` | 跨域白名单 |

## 部署

通用方式（任意 Docker 平台 / VPS）：

```bash
docker build -t weather-helper .
docker run -p 8000:8000 -v wh_data:/data weather-helper
```

### 部署到 Railway

1. 推送代码到 GitHub（仓库根目录含 `Dockerfile` 与 `railway.toml`，Railway 会自动识别）
2. [railway.com](https://railway.com) 用 GitHub 登录 → **New Project → Deploy from GitHub repo** → 选本仓库
3. 构建完成后，进入服务 → **Variables** 添加：

   | 变量 | 值 |
   |---|---|
   | `PORT` | `8000` |
   | `DATABASE_URL` | `sqlite:////data/weather.db` |
   | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `backend/.env` 里的两个值（或 `npx web-push generate-vapid-keys` 重新生成） |
   | `VAPID_SUBJECT` | `mailto:你的邮箱` |

4. 服务右上角 **… → Attach Volume** → 挂载路径填 `/data`（保存 SQLite 数据库，重部署不丢数据）
5. **Settings → Networking → Generate Domain** → 端口填 `8000` → 得到 `https://xxx.up.railway.app`（自动 HTTPS，PWA 安装与 Web Push 可用）

首次启动会自动导入 57 个球场并抓取全部天气数据（约 1 分钟内出数据），可信度评分从零开始积累。
球场来源有两路：LCSD 开放数据 feed（54 个）+ `backend/app/services/lcsd.py` 里的 `EXTRA_COURTS` 手工补录名单（开放数据还没收录的新场/非康文署场，坐标经 OpenStreetMap 核实）。想再加场，往 `EXTRA_COURTS` 里照格式添一条、推送即可，重启后自动合并；若哪天 feed 收录了同名场地会自动去重。
注意：不挂 Volume 的话每次重新部署数据库都会清空、评分重新积累。

**验证数据有没有丢**：访问 `https://你的域名/api/health`，看 `db` 字段——
- `db_file_created_at` 是数据库文件的创建时间。挂了卷：它停留在首次部署时刻，跨多次部署不变；没挂卷：每次部署后都重置为刚才的部署时间。
- 各行数（`observations`、`forecast_snapshots`、`climatology_cells` 应为 15552 等）随时间增长；若每次部署后归零重来，就是没挂卷。
- 最快的人工确认：Railway 面板 → 服务 → **Settings → Volumes**，看是否有挂载在 `/data` 的卷。

本地没有 Docker 也能部署——构建全部在 Railway 云端完成。

## API 一览

- `GET /api/courts?search=&prefix=A` 球场列表（含未来 2h 降雨徽章、可信度摘要）
- `GET /api/courts/{id}` 球场详情 + 评分
- `GET /api/courts/{id}/weather` 组合天气（临近预报 + 48h 概率 + 当前天气 + 警告）
- `POST /api/reports`（Header `X-Device-ID: <uuid>`）到场实况上报
- `GET /api/reports/status?court_id=` 上报冷却/配额状态
- `GET /api/push/public-key` · `POST /api/subscriptions` · `DELETE /api/subscriptions?endpoint=`

## 二期方向

- LCSD SmartPlay 可租订时段展示（API 已知：`data.smartplay.lcsd.gov.hk`，5 分钟更新）
- 用户私藏/审核制私人球场；预报概率按球场历史校准映射；信任等级与举报机制；
  临近预报 2-6 小时空档的多源融合（OCF 等）
