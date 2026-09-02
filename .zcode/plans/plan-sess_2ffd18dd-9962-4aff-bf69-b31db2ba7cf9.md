# 天气小助手（香港网球版）实施计划

对已有天气预报做「二次评价」的 PWA：按球场看未来逐小时降水概率 + 临近降雨预报，用户到球场后可上报实况，系统自动+人工双轨验证预报准确度，给出每球场的预报可信度评分。

## 技术栈与架构

- **后端**：Python 3.12 + FastAPI + SQLAlchemy 2 + SQLite（MVP，结构兼容后续换 PostgreSQL）+ APScheduler（进程内定时任务，适配长驻服务部署）+ httpx + pywebpush
- **前端**：React 19 + Vite + Tailwind CSS 4 + vite-plugin-pwa（可安装到主屏、Web Push）
- **部署**：单进程长驻服务（Fly.io/Railway/VPS 均可），提供 Dockerfile

```
weather_helper/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI 入口
│   │   ├── config.py / db.py / models.py / schemas.py
│   │   ├── api/               # courts / weather / reports / scores / subscriptions
│   │   ├── services/
│   │   │   ├── lcsd.py        # LCSD 球场数据导入与清洗
│   │   │   ├── hko.py         # HKO 常规 API（rhrread/flw/fnd、自动站实测雨量）
│   │   │   ├── hko_nowcast.py # HKO F3 网格降雨临近预报解析（最近网格点）
│   │   │   ├── open_meteo.py  # Open-Meteo 批量逐小时预报（一次请求带多经纬度）
│   │   │   ├── ingest.py      # 定时抓取：预报快照 + 实测雨量落库
│   │   │   ├── verification.py# 评分引擎：快照 vs 实测/用户上报
│   │   │   ├── antifraud.py   # 地理围栏、冷却、速度校验、权重封顶
│   │   │   └── push.py        # Web Push（VAPID）
│   │   └── scheduler.py       # APScheduler 任务编排
│   ├── tests/                 # 评分/围栏/解析逻辑的 pytest
│   └── pyproject.toml
├── frontend/                  # React PWA
│   └── src/{pages,components,api}
└── README.md
```

## 球场数据：LCSD 自动导入，无需手动添加

- 数据源：康文署开放数据 JSON（`https://www.lcsd.gov.hk/datagovhk/facility/facility-tc.json`），**全港 55 个政府网球场**，一次性导入 + 提供手动刷新命令
- 每条记录含：中英文名称、地区、地址、场地数（含泛光灯等备注）、开放时间、电话、附属设施、GIHS 唯一编码、经纬度
- 导入清洗：**度分秒坐标（"22-16-57"）→ 十进制经纬度**；官方中文名为繁体，搜索做繁简兼容（后端用 opencc 预生成简体名字段）
- 字段全量入库（开放时间/电话等在球场详情页直接展示），A-Z 字母索引按英文名首字母
- **MVP 不做手动添加球场**（私人会所球场留二期）；地理围栏、统计归属全部基于这 55 个官方坐标

## 天气数据源（全部免费、无需 key）

| 用途 | 来源 | 抓取频率 |
|---|---|---|
| 未来 2h 每 30 分钟降雨（最准的临近预报） | HKO 网格点降雨临近预报 CSV：`https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv`（每 12 分钟更新；实现时先探明 CSV 列结构，按最近网格点取值） | 12 分钟 |
| 逐小时降水概率/雨量/风（0-48h，任意球场坐标） | Open-Meteo：`api.open-meteo.com/v1/forecast?hourly=precipitation_probability,precipitation,weather_code,wind_speed_10m&latitude=..&longitude=..`（免费非商用 1 万次/天，支持一次请求多个坐标） | 1 小时 |
| 实测雨量（自动验证的地面真值） | HKO 自动站过去 1 小时雨量（weather.php 开放数据，每 15 分钟），取离球场最近测站 | 15 分钟 |
| 当前天气/警告 | HKO `rhrread`/`flw` | 15 分钟 |

## 数据模型（核心表）

- `courts`：id、name_en、name_tc、name_sc（opencc 生成）、district、address、lat、lon（十进制）、court_no、opening_hours、phone、gihs
- `forecast_snapshots`：source（`open_meteo`/`hko_f3`）、court_id、target_hour（预报的目标时刻）、precip_prob、precip_mm、fetched_at —— **每个时刻把当时预报原样存档，这是二次评价的地基**
- `observations`：court_id、observed_hour、source（`hko_station`/`user`）、rain_observed（bool，按 1h 雨量≥0.1mm 阈值判定）、meta
- `user_reports`：court_id、device_id、was_raining、intensity（无/小/中/大）、上报时 lat/lon/精度、created_at
- `source_scores`：source × court 的滚动统计（命中/漏报/误报/正确否定的混淆矩阵、准确率、POD、FAR、Brier Score、样本量 n）——每日重算
- `push_subscriptions`：订阅信息、court_id、提醒提前量（默认 30 分钟）

## 核心逻辑

**评分方法（修正原方案）**：单次"预报下雨→真下了"验证不了概率数字，因此分两层：
1. **自动验证（冷启动即可用、无刷量风险）**：每小时把 target_hour 已到的预报快照，与最近测站实测雨量比对，滚动 30 天统计每球场各数据源的准确率/POD/FAR/Brier
2. **用户上报（增量修正）**：上报本质是众包即时观测，能捕捉测站漏掉的局部骤雨；与快照对齐后并入统计，但单设备单球场在聚合窗口内权重封顶
- 展示规则：样本量 n<20 时标注"数据积累中"，不显示星级

**防刷（地理围栏+频率+合理性）**：
- 服务端校验上报位置距球场 ≤500m（haversine）
- 同 device 同球场冷却 2h，每 device 每日上限 10 次
- 速度合理性：与该 device 上次上报位置比对，物理上不可能的移动直接标记丢弃
- device_id 为前端生成并存 localStorage 的 UUID（MVP 匿名，不做注册）

**多源对比**：HKO 临近预报与 Open-Meteo 分别独立评分，球场详情页并排展示"HKO 2h 临近预报准确率 xx%（n=xx）/ Open-Meteo 48h 准确率 xx%（n=xx）"。

**推送提醒**：用户收藏球场并设定打球时段 → 调度器在 T-30min 检查该球场 PoP≥50% 或 HKO 临近预报有雨 → Web Push 提醒。

## API 概要

- `GET /api/courts?search=&prefix=A`：列表+搜索（匹配英/繁/简名），每项带未来 2h 降雨摘要+可信度星标
- `GET /api/courts/{id}/weather`：组合视图（HKO 0-2h 每 30min + Open-Meteo 48h 逐小时 + 当前天气 + 各源评分）
- `GET /api/courts/{id}/scores`：混淆矩阵、准确率、Brier、趋势（近 7/30 天）
- `POST /api/reports`：上报实况（X-Device-ID 头），服务端做围栏/频率/速度校验
- `POST/DELETE /api/subscriptions`：推送订阅管理

## 前端页面

1. **球场列表**：右侧 A-Z 字母索引条（按英文名首字母）+ 顶部搜索框，行内显示球场名、地区、未来 2 小时降雨徽章、可信度星级
2. **球场详情**：临近预报条（0-2h）→ 逐小时概率条形图（48h）→ 预报源对比卡（各源准确率+样本量）→ 球场信息（开放时间/电话/场地数）→「我现在在这里，上报实况」按钮
3. **上报流程**：取 GPS 定位 →（在围栏内才可提交）选"没下雨/小雨/中到大雨" → 提交后显示冷却倒计时
4. **提醒订阅**：选球场+时段，浏览器通知授权
5. PWA manifest + Service Worker（离线缓存基础壳）

## 实施步骤（顺序）

1. 项目脚手架（backend + frontend 双目录、依赖、git 首次提交）
2. 探明数据格式：实际抓取 F3 CSV、LCSD JSON（字段已确认）、HKO 雨量 API，确认后写解析器和单测
3. LCSD 球场导入（DMS→十进制、opencc 繁转简）+ 定时抓取任务（快照与实测落库）
4. 组合天气查询 API + 评分引擎（含 pytest 覆盖评分/围栏/冷却逻辑）
5. 上报 API（防刷全套）
6. 前端：列表页 → 详情页 → 上报流程 → 订阅推送
7. Dockerfile + README（含部署说明）+ 全链路本地跑通

## 已知风险与对策

- F3 网格 CSV 列结构未探明 → 步骤 2 最先验证，必要时改用 CSDI Geoportal 空间接口
- Open-Meteo 概率来自 27km 集合预报，对香港局部骤雨偏粗 → 这正是产品的立意：用 HKO 临近预报+用户上报修正，UI 上注明各源特性
- GPS 伪造无法根治 → MVP 靠围栏+速度校验+权重封顶抑制，接受残余风险
- HKO 临近预报只有 2h 时效 → 2-6h 空档由 Open-Meteo 补，UI 分段标注数据源