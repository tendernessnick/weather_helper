# 网球天气助手（香港）

出门打室外网球，最想知道的是：未来一两小时，这个球场到底会不会下雨。
这个项目在官方预报之上做**二次评价**：按球场展示逐小时降雨预报，用户到场后可上报实况，
系统用「天文台测站实测 + 球友众包上报」双轨自动验证每个预报源在该球场的准确率，
帮你判断"这个球场的预报今天信不信"。

### 2026-11-14 体验与可靠性优化

- **按这一场看风险**：球场详情选择开打时间和 1/2/3 小时时长，逐小时核对覆盖，展示时段内最高风险。显示与提醒输入均按香港时间，跨时区设备一致。
- **收藏与筛选**：球场支持本机收藏、地区筛选、中英搜索；筛选写入 URL，回到列表或刷新仍可恢复。
- **旧数据不当作无雨**：SWIRLS 按官方发布时间判断新鲜度（25 分钟），逐小时预报期限为 180 分钟；缺失、过期、覆盖不全或离线时，场次面板显示无法判断。雨图缺数据的球场为灰色。
- **弱网恢复**：请求超时、失败重试、排行榜切换时取消旧请求、页面恢复后刷新；按页拆分 JavaScript，适配窄屏导航和减少动态效果的系统偏好。
- **统计修复**：修正偶数样本中位数、Peirce 单类别除零、薄桶校准异常，以及 BSS 模型与基准的样本配对。

优化方案、测试及回退方式见 [本轮验收记录](docs/optimization-20261114/VALIDATION.md)。融合值是启发式风险指数（0–100），尚未独立验证为降雨概率；场次面板的峰值不是整场下雨概率。


## 功能一览

- **球场列表**：全港 57 个公共网球场，A-Z 字母索引 + 中英文搜索
- **未来 2 小时降雨**：天文台 SWIRLS 网格点临近预报（每 12 分钟更新、半小时一档、精确到球场坐标）
- **逐小时降水概率**：Open-Meteo 集合预报（未来 48 小时，任意球场坐标）
- **融合风险指数（0-6h）**：雷达覆盖内「SWIRLS 70% + 校正预报 30%」、覆盖外「校正预报 70% + 十年同期气候 30%」加权，填补临近预报结束到中期预报之间的空档
- **雷电警报**：天文台对地闪电数据（按四区域），球场所属区域有对地闪电时红色横幅警示
- **预报可信度评分**：对每个球场分别给「天文台临近预报」和「Open-Meteo」打分（准确率 / 漏报率 / 误报率 / Brier，滚动 30 天）
- **到场实况上报**：地理围栏 + 冷却 + 每日上限 + 位移校验，防刷数据
- **下雨风险推送**（PWA Web Push）：开打前 30 分钟若有下雨风险则提醒
- **意见反馈**：用户提交建议/Bug/数据纠错，直达管理后台收件箱

## 使用指南

### 安装到手机

用手机浏览器（Edge / Chrome / Safari）打开站点 → 菜单里选「添加到主屏幕」。
之后从桌面图标点开即是全屏应用（无浏览器地址栏）；开打前的下雨风险提醒
依赖 Web Push，安装后即使页面关闭也能收到。

### 首页

- 「查看球场天气」进列表；「我现在就在球场」直接定位找最近球场
- 实时数据条：球场数、累计上报、打卡数、未来一小时全港中位降雨概率
- 底部「意见反馈」：任何页面都能提交建议 / Bug / 数据纠错，直达管理后台

### 球场列表

按英文名 A-Z 排列，右缘字母栏可点击/滑动快速定位。每行显示：
星级（预报准确率，样本不足显示"积累中"）、未来 2 小时雨/无雨徽章。

### 球场详情（核心页面，从上往下）

| 区块 | 回答的问题 |
|---|---|
| 生效警告 + 雷电警报 | 天文台当前警告；过去 1 小时本区域有对地闪电时红色警示（雷暴期间请勿在露天场逗留） |
| 场次面板 | 选择开打时间与 1/2/3 小时，检查完整覆盖与新鲜度，按最差小时显示风险；缺数据或警告时提示确认 |
| 酷热提醒 | 未来 6 小时体感最差时段 ≥32°C 时提示补水避暑 |
| 微气候旗标 | 本场球友上报与最近测站经常「你说晴我说雨」时点亮：请更信临近预报与球友上报 |
| 未来 2 小时降雨 | SWIRLS 雷达外推，半小时一档，0-2 小时内最可信 |
| 上报实况 | 我就在这个球场：四档雨情点一下（需定位在球场 500 米内，2 小时冷却），下方滚动展示最近 3 小时球友上报 |
| 逐小时图 | 未来 48 小时。可切「降雨概率 / 体感温度 / 风速」；概率模式下蓝条=官方预报、黑点=校正后、琥珀点=融合值（仅前 6 小时）；点柱子看三个数与人话判读；预报雷暴的时段有 ⚡ 角标 |
| 校正对照卡 | 这个球场的预报数字历来虚高还是保守：左列预报说的，右列实际发生的 |
| 持续性卡 | 现在没下雨能顶几小时？现在下了 1 小时内会停吗？（本区当月十年实测） |
| 评分卡 | 这个球场的预报可信吗：两个预报源 × 两个真值的漏报/误报率 |
| 打卡 | 打完球记一笔，自动用实测档案回顾那天的天气，进个人战报 |
| 提醒订阅 | 设定开打时间，前 30 分钟若概率 ≥50% 或临近预报有雨则推送 |
| 反馈数据问题 | 针对本球场提交纠错，直达管理后台 |

### 去哪打

选一个未来 18 小时内的时段，按**校正后概率升序**排全场最干的 20 个球场；
雨团地图看雨现在在哪、离你多远、往哪走（可全屏缩放、双指操作）。

### 洞察

两个预报源的成绩单：技不技巧（BSS）、准不准（可靠性）、提前多久看才靠谱、
哪个球场骗人最少、哪个小时的"没雨"最要防……每一项的读法与实现见下一章。

---

## 统计指标详解：意义与实现

### 先讲数据管道（后面所有指标的基础）

1. **预报快照冻结**：Open-Meteo 每小时抓取落库（`forecast_snapshots`）；
   已开始的小时不再覆写——每个小时保留"开打前最后那版预报"，即用户决策时看到的版本，
   也是事后唯一该被问责的版本。另有 `forecast_leads` 表在预报首次进入
   l3(≤3h)/l12(≤12h)/l24(≤30h)/l48(≤50h) 档时冻结一份，专供提前量分析。
2. **临近预报快照**：SWIRLS 每 12 分钟的全港网格 CSV，按球场取最近格点存 4 个 30 分钟步（`nowcast_snapshots`）。
3. **两种验证真值**：
   - **测站实测**：HKO 36 个自动站过去 1 小时雨量，每球场映射最近测站，≥0.1mm 记为下雨（`observations`）
   - **球友上报**：围栏内上报按「球场+小时」聚合，同设备每小时一票，多数决出该小时下没下雨——
     能捕捉测站漏掉的局部骤雨，是独立于官方观测的第二真值
4. 所有指标滚动 **30 天窗口**（`WINDOW_DAYS`），样本 <20（`MIN_SAMPLES`）显示"—/积累中"。

### 1. 预报可信度评分（球场页评分卡 / 列表星级）

**回答**：这个球场的这份预报，过去 30 天说话靠谱吗？

- **准确率** = (报雨且真雨 + 报干且真干) / 总数。注意香港干多雨少，闭眼全说"没雨"也有 ~88% 准确率，所以准确率必须对照下面的漏报/误报读
- **漏报率 POD 的补**：真下了却报没雨的比例（`M/(H+M)`）——高 = 要防突发雨
- **误报率 FAR**：报了雨却没下的比例（`F/(H+F)`）——高 = 其实可以赌一把
- **Brier**：`(预报概率 − 实际0/1)²` 的均值，概率预报的均分误差，越低越好。临近预报是确定性输出，不计 Brier

**实现**（`services/verification.py`）：对每个「球场 × 预报源 × 真值」组合，
滚动窗口内逐小时配对：Open-Meteo 取概率 ≥50%（`POP_RAIN_THRESHOLD`）记为预报有雨，做二分类混淆矩阵 + Brier；
SWIRLS 取该小时开始前最后一份快照，其中落在本小时的 30 分钟步 ≥0.05mm 记为预报有雨。
列表星级由 Open-Meteo 对测站真值的准确率映射（1-5 星，60 秒缓存）。

### 2. 校正概率（逐小时图黑点 / 校正对照卡）

**回答**：预报说 60%，在这个球场（或全港）历史上实际是多大？

**实现**（`services/stats.py:recalibrate` + `analytics.py`）：把 30 天内全部
「官方概率 → 实际 0/1」配对按官方概率分 10 桶，算每桶实际下雨频率，桶心之间线性插值
得到单调的映射函数 f，黑点 = f(官方概率)。全港合并口径 10 分钟缓存；
单个球场专属映射要求样本 ≥40 且湿事件 ≥30（雨太稀，没够雨样本学不出东西），
不够时自动回落到全港口径并在卡片上注明。

### 3. 融合风险指数（0-6h 琥珀色点 / 场次面板）

**回答**：雷达只能看 2 小时、中期概率前几个小时偏弱，中间空档听谁的？

**实现**（`services/fusion.py`）：对未来 6 个整点，把 SWIRLS 的 30 分钟步归入所在小时，
该小时湿润步占比为雷达信号 p_sw（时间覆盖比例，不是经校准的降雨概率）。雷达新鲜（≤25 分钟）且覆盖该小时：
`融合值 = 0.7×p_sw + 0.3×校正概率`；超出雷达覆盖：`融合值 = 0.7×校正概率 + 0.3×十年同期气候频率`。
纯读取时计算，不新增存储。

### 4. 决策分区（低风险 / 需留意 / 高风险）

**回答**：今晚到底去不去？

校正概率或融合指数在对应量纲下 ≤30 → 低风险（go）、≤60 → 需留意（edge）、>60 → 高风险（no）。
场次面板按选定时长内最高小时风险分区；缺数据/过期/离线优先显示无法判断，生效警告优先提示查看警告。这个分区不是安全保证（`analytics.decision_zone`）。

### 5. 持续性卡（等雨停 / 能顶多久）

**回答**：两个最实际的问题——现在没雨，打 2 小时能顶住吗？现在下了，1 小时内会停吗？

**实现**（`services/climate.py` + `persistence` 表）：用 Open-Meteo ERA5 十年逐小时档案
（~11km 网格）回填每个球场 × 月份 × 小时的雨频率（≥0.5mm 记雨，过滤 ERA5 的毛毛雨噪声），
再按月统计 1 小时马尔可夫转移（干→干 / 干→湿 / 湿→湿 / 湿→干）：
"顶住" = P(接下来 L 小时全干 | 当前干)，L=1..4；"会停" = P(下一小时转干 | 当前湿)。

### 6. 技巧分 BSS 与误差三分解（洞察页主卡）

**回答**：这份预报比"只查历史平均"聪明多少？——这才是预报的真本事，因为闭眼说"没雨"也能蒙对 88%。

- **BSS = 1 − BS/BS_气候基线**。>0 说明有正技巧；洞察页把它翻译成"比直接翻历史账本准 X%"
- **三分解**（Murphy）：BS = 可靠性（REL，数字虚高的损失）− 分辨率（RES，能区分下不下的能力）+ 不确定性（UNC，天气本身的随机，谁也消不掉）。洞察页的红蓝灰三条就是这个

**实现**（`services/stats.py:brier_decomposition`）：对窗口内全部（概率, 结果, 气候频率）三元组按标准公式计算。

### 7. 可靠性曲线（"它说的 60%，实际是 60% 吗"）

**回答**：预报的数字本身能不能按面值信？

**实现**：把预报概率分桶（横轴=桶内平均预报概率，纵轴=桶内实际下雨频率，气泡大小=样本量），
点落在对角线上=说到做到；整体压在对角线下方=爱报大话（正是校正映射要修的事）。

### 8. 漏报/误报的置信区间

**回答**：漏报率 20% 是真的稳，还是小样本抖出来的？

**实现**：Wilson 比例区间（`stats.wilson_ci`），比正态近似在小样本下诚实。
洞察页所有比率类指标都带 95% 区间；两条球场横条若区间重叠 = 实际没有差别，别纠结名次。

### 9. Heidke / Peirce 技能分

**回答**：比瞎猜好多少？

Heidke = 相对"随机猜"的技巧；Peirce（又称 Hanssen–Kuipers）= 相对"按气候频率猜"的技巧，
对稀有事件（雨）更公平。两者 >0 才有技能，实现见 `stats.heidke / stats.peirce`。

### 10. 突发雨捕获率

**回答**：毫无征兆开场的雨，预报能不能提前抓到？

**实现**（`analytics.overview`）：某小时**前一个被观测的小时是干的**且本小时下雨，记一次 onset
（上一小时缺测则链条重置，不借旧账）；onset 中预报报了雨的比例即捕获率。
这是对"漏报率"的补充——平时报不报得准是一回事，会不会被突然袭击是另一回事。

### 11. 提前量衰减（l3/l12/l24/l48）

**回答**：提前两天订场时看的预报，和出门前看的差多少？

**实现**：`forecast_leads` 表在每份预报首次进入 3/12/24/48 小时档时冻结一份副本
（之后不再覆写），各档独立算准确率/POD/BSS。典型形态：越早越糊（衰减曲线），
它直接回答"提前订场该信几分"。样本没攒够的档显示"积累中"。

### 12. 每小时漏报画像

**回答**：几点的"没雨"最要留心眼？（答：清晨，辐射性阵雨高发且预报系统性低估）

**实现**：按小时OfDay聚合 30 天漏报数与 Wilson 区间，洞察页画成 24 柱图。

### 13. 球场排名（收缩估计 + 微气候旗标）

**回答**：哪个球场的预报最靠谱 / 哪个球场天生骗人？

**实现**（`analytics.courts_ranking`）：
- **收缩估计**：每个球场的漏报率向全港平均收缩——`(命中数 + 200×全港率)/(样本数 + 200)`
  （经验贝叶斯伪计数，`stats.shrinkage`）。样本小的球场自动向均值靠拢，防止 5 个样本的 0% 漏报登顶
- **置信区间**：Wilson 区间，横条重叠 = 没有实际差别
- **微气候旗标**：该球场球友上报与最近测站"你说晴我说雨"的分歧率 >15% 且 n≥20 时点亮
  （`stats.dual_truth_divergence`）——这类场地请更信临近预报与球友上报，测站口径评分仅供参考

### 14. 预报质量走势

**回答**：预报最近变准了还是飘了？

**实现**（`analytics.quality_trend`）：30/90/180 天逐日准确率与 Brier + 7 天滚动线；
最近 7 天与全期均值差 ≥ 若干百分点时给一句人话结论（更准了 / 有点飘 / 持平）。

### 15. 干湿排行（十年气候底数）

**回答**：跟预报无关——哪些球场天生更干/更湿？（选长期主场用）

**实现**：十年 ERA5 档案按当月或全年算各球场雨频率，与全港均值比差多少个百分点
（`analytics.dry_ranking`）。约 11km 网格意味着同区球场数值接近，这是特性不是 bug：
它反映的是地理气候差异。

### 16. 两源分歧裁决

**回答**：Open-Meteo 和天文台临近预报打架时，历史上谁更常对？

**实现**（`analytics.disagreement`）：找出两源结论相反的小时（OM 报雨×临近说干、临近报雨×OM 说干），
分别统计各源对实测的胜率。临出门时两源打架，看这张卡知道先信谁。

### 上报数据本身的统计（管理后台）

今日上报/采纳/被拒按拒绝原因分解（围栏/精度/冷却/每日上限/移速），7 天趋势、
DAU（上报或打卡过去重的设备数）、提交时刻分布、订阅漏斗。上报反作弊规则：
围栏 500 米 + GPS 精度 ≤300 米 + 同场 2 小时冷却 + 每日 10 条 + 位移 ≤250km/h。

---

## 架构

```
├── backend/                Python 3.12 + FastAPI + SQLAlchemy + SQLite（自写守护线程调度器）
│   ├── app/api/            courts / reports / feedback / subscriptions / stats / best / map / checkins / admin 路由
│   ├── app/services/       数据抓取(HKO/Open-Meteo/LCSD)、验证评分、校准、融合、防刷、推送、雷电、气候档案
│   └── tests/              80 个 pytest（评分/围栏/解析/融合/反馈等）
├── frontend/               React 19 + Vite + Tailwind 4 + vite-plugin-pwa
│   └── scripts/            gen-icons.mjs（改 public/icon.svg 后 npm run icons 重出 PNG）
└── Dockerfile              前后端一体镜像（单进程长驻服务）
```

## 数据源（全部免费、无需 API key）

| 用途 | 来源 | 频率 |
|---|---|---|
| 未来 2h 每 30 分钟降雨 | [HKO 网格点降雨临近预报](https://data.gov.hk/en-data/dataset/hk-hko-rss-gridded-rainfall-nowcast-in-hong-kong) | 12 分钟 |
| 实测雨量（验证真值） | [HKO 自动站过去一小时雨量](https://data.weather.gov.hk/weatherAPI/opendata/hourlyRainfall.php?lang=en)（36 站，映射到最近球场） | 15 分钟 |
| 逐小时降水概率 | [Open-Meteo](https://open-meteo.com/)（免费非商用 1 万次/天，批量坐标） | 1 小时 |
| 当前天气/警告 | HKO `rhrread` | 15 分钟 |
| 对地闪电次数（4 区域） | [HKO LHL 开放数据](https://data.gov.hk/en-data/dataset/hk-hko-rss-cloud-ground-lightning-count-past-hour) | 15 分钟抓取（上游每小时更新） |
| 球场名称/坐标 | [LCSD 康文署开放数据](https://www.lcsd.gov.hk/datagovhk/facility/facility-tc.json) | 启动导入 |
| 十年逐小时气候档案 | Open-Meteo ERA5（回填一次性完成，仅存聚合） | 每日增量 |

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
改了 `public/icon.svg` 后跑 `npm run icons` 重新生成各尺寸 PNG。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./weather.db` | 换 PostgreSQL 用 `postgresql+psycopg://...` |
| `GEOFENCE_METERS` | `500` | 上报地理围栏半径 |
| `REPORT_COOLDOWN_HOURS` | `2` | 同设备同球场冷却 |
| `DAILY_REPORT_LIMIT` | `10` | 每设备每日上报上限 |
| `MAX_SPEED_KMH` | `250` | 位移速度上限（防瞬移刷量） |
| `MAX_GPS_ACCURACY_METERS` | `300` | 上报 GPS 精度上限（精度差于该值拒收） |
| `POP_RAIN_THRESHOLD` | `50` | 概率≥此值记为"预报有雨"；推送触发线 |
| `RAIN_MM_THRESHOLD` | `0.1` | 测站实测过去 1 小时 ≥ 此毫米数记为「下雨」（验证真值） |
| `NOWCAST_MM_THRESHOLD` | `0.05` | 临近预报 30 分钟步 ≥ 此毫米数记为「报雨」 |
| `WINDOW_DAYS` / `MIN_SAMPLES` | `30` / `20` | 评分窗口与最小样本 |
| `VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY` | 空 | Web Push 密钥（生成：`npx web-push generate-vapid-keys`） |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Web Push 发件人标识（mailto: 邮箱） |
| `ADMIN_TOKEN` | 空 | 后台管理看板（`/admin`）的访问令牌，不设置则后台 API 返回 503 |
| `FEEDBACK_COOLDOWN_MINUTES` | 10 | 意见反馈的同设备冷却分钟数 |
| `FEEDBACK_DAILY_LIMIT` | 5 | 意见反馈的每设备每日上限 |
| `CORS_ORIGINS` | `*` | 跨域白名单 |

## 部署

通用方式（任意 Docker 平台 / VPS）：

```bash
docker build -t weather-helper .
docker run -p 8000:8000 -v wh_data:/data weather-helper
```

### 部署到腾讯云 CloudBase（当前使用）

2026-10 起从 Railway 迁到 CloudBase 云托管（CloudRun 容器型）。选容器型而不是云函数，
是因为应用依赖**进程内常驻调度器**（8 个定时抓取/推送任务）和 Web Push 长驻服务，
缩容到 0 即停摆，只有常驻实例能承载。

线上地址：`https://weather-helper-312215-10-1477032709.sh.run.tcloudbase.com`
（CloudBase 控制台 → 云托管 → weather-helper；环境 `nick-cloudbase`，上海地域）

1. [tcb.cloud.tencent.com](https://tcb.cloud.tencent.com) 登录 → 选环境 → **云托管** → 新建服务
   `weather-helper`，上传仓库根目录（或用 CloudBase MCP `manageCloudRun(action="deploy")` 从本地直接部署，
   注意排除 `.venv`/`node_modules`——工具没有 ignore 参数，先用 `git archive HEAD | tar -x` 导出干净目录再传）
2. 服务配置：

   | 配置 | 值 | 原因 |
   |---|---|---|
   | CPU / 内存 | 0.25 核 / 0.5G | 最低档够用（Mem 必须是 CPU 的 2 倍） |
   | 实例数 | Min=1 / **Max=1** | 调度器在进程内，缩到 0 就停抓数据；Max>1 会多实例重复跑任务 |
   | 公网访问 | 开启 PUBLIC | PWA 安装与 Web Push 需要公网 HTTPS |
   | 监听端口 | 8000 | 镜像 CMD 读 `PORT`，默认 8000 |

3. 环境变量（服务设置 → 环境变量）：

   | 变量 | 值 |
   |---|---|
   | `PORT` | `8000` |
   | `DATABASE_URL` | `sqlite:////data/weather.db` |
   | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | 沿用 `backend/.env` 里的值（不换密钥，已装用户的推送订阅继续有效） |
   | `ADMIN_TOKEN` | `backend/.env` 里的值（后台看板令牌） |

4. 首次启动自动导入 57 个球场并抓取全部数据源（约 1 分钟出数据）；
   验证看 `GET /api/health` 的 `db` 字段。

球场来源有两路：LCSD 开放数据 feed + `backend/app/services/lcsd.py` 里的 `EXTRA_COURTS`
手工补录名单（开放数据还没收录的新场/非康文署场，坐标经 OpenStreetMap 核实）。想再加场，
往 `EXTRA_COURTS` 里照格式添一条、重新部署即可，启动时自动合并去重。

**验证数据有没有丢**：回读实际存储挂载配置，逐表核对行数、关键时间范围，并做恢复验证。`/api/health` 的 `db.db_file_created_at` 当前取自 `st_ctime`，Linux上并非可靠的文件创建时间，不能据其变新就断定丢库。

**持久化状态（2026-11-14实查）**：当前服务 `VolumesConf=[]`，SQLite仍位于容器临时盘，不能依赖重新部署保留数据。自动采集只能补回当前预报和后续观测，不能重建历史发布版本、过去测站真值、上报、打卡或订阅。

本轮已保全完整时间点快照，完成本机恢复验证，并将AES加密副本存入私有桶。详见 [历史数据保留验收](docs/storage-preservation-20261114/README.md)。正式切换前仍需补做最终快照或增量同步。

- **优先评估已有共享PostgreSQL**：当前CloudBase环境已有实例；先核对真实连接入口和增量费用，再适配SQLite专用SQL、迁移、诊断和数据导入，不能只换 `DATABASE_URL`。
- **本地盘SQLite + 定期私有加密快照**：可作为带持久磁盘平台上的替代或过渡方案，需明确备份间隔和恢复流程。
- **CFS/NFS不直接作为默认SQLite主库方案**：网络文件锁与同步语义需额外验证，单实例不等同无风险；还需核对VPC、套餐资格和费用。对象存储适合备份，不作为SQLite在线文件系统。

历史部署工具曾出现挂载配置未生效的情况；当前工具能力以实际版本和平台回读为准，每次发布均需独立核对 `VolumesConf` 和恢复结果。

## 后台管理看板（/admin）

仅站长可见的运营看板，凭令牌进入（浏览器打开 `https://你的域名/admin`，输入 `ADMIN_TOKEN` 的值，令牌只存在你浏览器的 localStorage，不会出现在 URL 里）。看板 60 秒自动刷新，内容包括：

- **数据抓取新鲜度**：每个数据源（临近预报 / 雨量观测 / 当前天气 / 逐小时预报 / 雷电记录）最新一条数据距今多久，绿=按时、黄=略迟、红=停滞
- **定时任务**：8 个后台任务的运行次数、失败次数、最近一次成功时间、下次运行倒计时、最近报错内容
- **今日上报**：总数 / 已采纳 / 被拒（按拒绝原因分解），以及近 7 天采纳上报趋势
- **最新上报流**：最近 50 条上报（含被拒），球场可点进详情页，可按"全部 / 已采纳 / 被拒"筛选
- **用户反馈**：今日 / 待处理统计，按状态筛选（待处理 / 已读 / 已解决 / 已忽略），每条含分类、全文、设备短号与关联球场链接，可直接流转状态
- **用户活跃**：打卡（今日 / 7 天 / 累计）、7 天活跃设备数、推送与轮询订阅数
- **数据库**：文件大小、创建时间（重部署后变新 = 卷丢了）、各表行数——即 `/api/health` 探针的可视化

## API 一览

- `GET /api/courts?search=&prefix=A` 球场列表（含未来 2h 降雨徽章、可信度摘要）
- `GET /api/courts/{id}` 球场详情 + 评分
- `GET /api/courts/{id}/weather` 组合天气（临近预报 + 48h 概率 + 融合值 0-6h + 雷电 + 当前天气 + 警告）
- `GET /api/courts/{id}/scores?window_days=` 可信度评分明细（两预报源 × 两真值，窗口 1-365 天可选）
- `GET /api/courts/{id}/reports/recent` 本球场最近 3 小时已采纳球友上报
- `GET /api/courts/{id}/calibration` 校正对照卡数据（含微气候旗标判定）
- `POST /api/reports`（Header `X-Device-ID: <uuid>`）到场实况上报
- `GET /api/reports/status?court_id=` 上报冷却/配额状态
- `GET /api/reports/latest?limit=5` 全站最近已采纳上报（首页"社区脉搏"，不含设备号）
- `POST /api/checkins`（Header `X-Device-ID: <uuid>`）打完球打卡（同场 6 小时冷却）
- `GET /api/checkins/my`（Header `X-Device-ID: <uuid>`）我的打卡历史
- `GET /api/checkins/report`（Header `X-Device-ID: <uuid>`）个人战报（打卡自动回顾当日天气）
- `GET /api/checkins/peek?code=` 恢复码校验（换设备后找回打卡数据）
- `GET /api/best?hour=YYYY-MM-DDTHH` 去哪打：该时段全场最干球场排行 + 未来 24 小时全港风险曲线（缺省下一整点；只含新鲜预报，附覆盖球场数；非法/非整点/已过去/超未来24整点的参数返回422）
- `GET /api/map/rain` 雨团地图（SWIRLS 网格数据，前端自绘渲染）
- `POST /api/feedback`（Header `X-Device-ID: <uuid>`）用户意见反馈（10 分钟冷却 / 每日 5 条）
- `GET /api/feedback/status` 反馈冷却/配额状态
- `GET /api/push/public-key` · `POST /api/subscriptions` · `DELETE /api/subscriptions?endpoint=`
- `POST /api/subscriptions/polling`（Header `X-Device-ID: <uuid>`）轮询订阅（Web Push 不可用时的回退）
- `GET /api/reminders/check`（Header `X-Device-ID: <uuid>`）取读到期的轮询提醒（前端每 60 秒查一次）
- `GET /api/stats/overview` 洞察总览（Open-Meteo 的 Brier/BSS/三分解/可靠性曲线 + 突发雨捕获率）
- `GET /api/stats/lead-decay` 提前量衰减（l3/l12/l24/l48 各档独立成绩）
- `GET /api/stats/hourly-profile` 每小时漏报画像（24 柱 + Wilson 区间）
- `GET /api/stats/courts` 球场排名（收缩估计 + 置信区间 + 微气候旗标）
- `GET /api/stats/quality-trend?days=90` 预报准确率逐日走势（含 7 天滚动平滑）
- `GET /api/stats/dry-ranking?month=0` 球场十年雨频率排行（month=0 全年，否则 1-12 月）
- `GET /api/stats/disagreement` 两预报源分歧时的历史胜负统计
- `GET /api/admin/overview`（Header `X-Admin-Token`）后台看板聚合数据（数据新鲜度 / 任务状态 / 上报流 / 反馈统计 / 行数）
- `GET /api/admin/feedback?status=`（Header `X-Admin-Token`）反馈收件箱
- `PATCH /api/admin/feedback/{id}`（Header `X-Admin-Token`）流转反馈状态（new/ack/resolved/dismissed）
- `GET /api/admin/activity?days=30`（Header `X-Admin-Token`）活跃趋势（DAU / 上报时刻分布 / 漏斗）
- `GET /api/health` 健康探针（数据库文件创建时间 / 大小 / 各表行数——部署后核对数据卷有没有丢）

## 二期方向

- LCSD SmartPlay 可租订时段展示（API 已知：`data.smartplay.lcsd.gov.hk`，5 分钟更新）
- 用户私藏/审核制私人球场；信任等级与举报机制；融合概率纳入评分验证体系


## 本地验证与 CI

```powershell
cd backend
uv sync --frozen
uv run pytest -q
cd ../frontend
npm ci
npm test
npm run build
npm run test:browser
```

浏览器测试自动启动本地构建预览，默认使用本机 Edge；其他环境先运行 `npx playwright install chromium` 并设置 `BROWSER_CHANNEL=chromium`。API 全部使用确定性测试数据，不会提交真实上报或订阅。可用 `WEATHER_BASE_URL` 指向已启动的本地预览。GitHub Actions 自动执行后端、前端和 Chromium 回归；产物为 `.zcode/qa/`，不纳入 Git。
