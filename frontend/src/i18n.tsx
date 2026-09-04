import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type Lang = 'hans' | 'hant' | 'en';
const IDX: Record<Lang, 0 | 1 | 2> = { hans: 0, hant: 1, en: 2 };

export const LANG_META: { id: Lang; label: string; htmlLang: string }[] = [
  { id: 'hans', label: '简', htmlLang: 'zh-Hans' },
  { id: 'hant', label: '繁', htmlLang: 'zh-Hant' },
  { id: 'en', label: 'EN', htmlLang: 'en' },
];

// Each entry: [简体, 繁體, English]. {x} slots are filled by t().
const S = {
  // --- app shell ---
  'app.title': ['网球天气助手', '網球天氣助手', 'Tennis Weather HK'],
  'app.subtitle': ['香港政府球场 · 降雨实况验证', '香港政府網球場 · 降雨實況驗證', 'HK public courts · rainfall, verified'],
  'tab.courts': ['球场', '球場', 'Courts'],
  'tab.best': ['去哪打', '去哪打', 'Best'],
  'tab.insights': ['洞察', '洞察', 'Insights'],
  'app.404': ['页面不存在', '頁面不存在', 'Page not found'],
  'app.footer1': ['预报数据：香港天文台 SWIRLS 临近预报 · Open-Meteo', '預報數據：香港天文台 SWIRLS 臨近預報 · Open-Meteo', 'Forecasts: HKO SWIRLS nowcast · Open-Meteo'],
  'app.footer2': ['实况核对：天文台自动站 + 球友上报 · 仅供参考', '實況核對：天文台自動站 + 球友上報 · 僅供參考', 'Ground truth: HKO gauges + player reports · For reference'],

  // --- shared ---
  'common.loading': ['加载中…', '載入中…', 'Loading…'],
  'common.building': ['积累中', '積累中', 'building up'],
  'zone.go': ['放心', '放心', 'GO'],
  'zone.edge': ['边缘', '邊緣', 'BORDER'],
  'zone.no': ['别赌', '别赌', 'NO'],
  'intensity.none': ['没下雨', '沒下雨', 'No rain'],
  'intensity.light': ['小雨', '小雨', 'Light'],
  'intensity.moderate': ['中雨', '中雨', 'Moderate'],
  'intensity.heavy': ['大雨', '大雨', 'Heavy'],
  'dir.N': ['北', '北', 'N'], 'dir.NE': ['东北', '東北', 'NE'], 'dir.E': ['东', '東', 'E'],
  'dir.SE': ['东南', '東南', 'SE'], 'dir.S': ['南', '南', 'S'], 'dir.SW': ['西南', '西南', 'SW'],
  'dir.W': ['西', '西', 'W'], 'dir.NW': ['西北', '西北', 'NW'], 'dir.overhead': ['头顶', '頭頂', 'overhead'],

  // --- court list ---
  'list.search': ['搜索球场或地区', '搜尋球場或地區', 'Search courts or districts'],
  'list.count': ['共 {n} 个康文署网球场 · 点柱子看三数与细节', '共 {n} 個康文署網球場 · 點柱看三數與細節', '{n} LCSD tennis courts · tap a court for hourly detail'],
  'list.noMatch': ['没有匹配的球场', '沒有匹配的球場', 'No matching courts'],
  'list.starsTitle': ['预报准确率 {p}%', '預報準確率 {p}%', 'Forecast accuracy {p}%'],
  'list.nowcastLoading': ['临近预报加载中', '臨近預報載入中', 'Nowcast loading…'],
  'list.rainBadge': ['未来2小时有雨 · ≤{mm}mm', '未來2小時有雨 · ≤{mm}mm', 'Rain within 2h · ≤{mm}mm'],
  'list.dryBadge': ['未来2小时无雨', '未來2小時無雨', 'No rain within 2h'],
  'list.railAria': ['字母索引', '字母索引', 'A-Z index'],

  // --- court detail ---
  'detail.notFound': ['球场不存在，', '球場不存在，', 'Court not found — '],
  'detail.backList': ['返回列表', '返回列表', 'back to list'],
  'detail.now': ['当前市区 {t}°C · 湿度 {h}%', '現時市區 {t}°C · 濕度 {h}%', 'Now in town {t}°C · humidity {h}%'],
  'detail.warnings': ['天文台生效警告', '天文台生效警告', 'HKO warnings in force'],
  'detail.microTitle': ['微气候球场', '微氣候球場', 'Microclimate court'],
  'detail.microBody': ['到场球友与最近天文台测站的观测多次分歧。本球场请更依赖临近预报与球友上报，测站口径的评分仅供参考。', '到場球友與最近天文台測站的觀測多次分歧。本球場請更依賴臨近預報與球友上報，測站口徑的評分僅供參考。', 'Player reports here have repeatedly diverged from the nearest HKO gauge. Rely more on the nowcast and player reports; gauge-based scores are indicative only.'],
  'detail.calibTitle': ['预报数字准不准？', '預報數字準不準？', 'How accurate are the numbers?'],
  'detail.calibOk': ['目前预报数字与实际接近，直接看官方概率即可', '目前預報數字與實際接近，直接看官方概率即可', 'Numbers closely match reality — take the official % at face value'],
  'detail.calibHigh': ['预报普遍虚高约 {p} 个百分点：说 {hi}% 时实际约 40%，以校正后的黑点为准', '預報普遍虛高約 {p} 個百分點：說 {hi}% 時實際約 40%，以校正後的黑點為準', 'Forecasts run ~{p} pts high: when they say {hi}%, reality is ~40%. Trust the black dot instead'],
  'detail.calibLow': ['预报普遍保守约 {p} 个百分点：实际比预报说的更容易下雨，留点余量', '預報普遍保守約 {p} 個百分點：實際比預報說的更容易下雨，留點餘量', 'Forecasts run ~{p} pts low — it rains more than claimed. Keep a margin'],
  'detail.calibBasis': ['依据近 30 天「官方预报 vs 实际下雨」对照（{basis}，n={n}）。下表左边是预报说的，右边是实际发生的：', '依據近 30 天「官方預報 vs 實際下雨」對照（{basis}，n={n}）。下表左邊是預報說的，右邊是實際發生的：', 'From 30 days of "forecast vs reality" ({basis}, n={n}). Left: what was forecast; right: what happened:'],
  'detail.basisCourt': ['本球场专属口径', '本球場專屬口徑', 'this court only'],
  'detail.basisPooled': ['全港合并口径，本球场样本积累中', '全港合併口徑，本球場樣本積累中', 'citywide pooled; court samples building'],
  'detail.saidPct': ['预报{p}%', '預報{p}%', 'said {p}%'],
  'detail.actualPct': ['实际{p}%', '實際{p}%', 'actual {p}%'],
  'verdict.go': ['未来 {n} 小时没有下雨风险，放心安排', '未來 {n} 小時沒有下雨風險，放心安排', 'Low rain risk for the next {n}h — go ahead'],
  'verdict.edge': ['整体可以安排；{hhmm} 前后概率略高（{pop}%），属边缘时段，带把伞赌一把', '整體可以安排；{hhmm} 前後概率略高（{pop}%），屬邊緣時段，帶把傘賭一把', 'Workable; slightly higher chance around {hhmm} ({pop}%) — a borderline window, bring an umbrella'],
  'verdict.no': ['{hhmm} 前后有较高下雨风险（{pop}%），建议改期或换个时段', '{hhmm} 前後有較高下雨風險（{pop}%），建議改期或換個時段', 'High rain risk around {hhmm} ({pop}%) — reschedule or pick another slot'],
  'comfort.severe': ['体感 {t}°C，极易中暑', '體感 {t}°C，極易中暑', 'Feels like {t}°C — dangerous heat'],
  'comfort.poor': ['体感 {t}°C，酷热', '體感 {t}°C，酷熱', 'Feels like {t}°C — very hot'],
  'comfort.fair': ['体感 {t}°C，偏热多喝水', '體感 {t}°C，偏熱多飲水', 'Feels like {t}°C — hot, drink water'],
  'comfort.good': ['体感 {t}°C，舒适', '體感 {t}°C，舒適', 'Feels like {t}°C — comfortable'],
  'comfort.windy': ['大风 {w}km/h 影响发球', '大風 {w}km/h 影響發球', 'Windy {w}km/h — serves affected'],
  'comfort.heatSevere': ['酷热警告', '酷熱警告', 'Extreme heat alert'],
  'comfort.heatPoor': ['偏热提醒', '偏熱提醒', 'Heat advisory'],
  'comfort.heatPeak': ['（{hh}:00 前后最热）', '（{hh}:00 前後最熱）', '(peaks around {hh}:00)'],
  'comfort.heatAdvice': ['多补水、挑早晚时段。', '多補水、挑早晚時段。', 'Hydrate and favour early/late slots.'],
  'comfort.noData': ['暂无体感数据', '暫無體感數據', 'No comfort data yet'],
  'server.checkinCooldown': ['同球场 6 小时内已打卡过', '同球場 6 小時內已打卡', 'Already checked in at this court within 6 hours'],

  // --- nowcast strip ---
  'now.title': ['未来 2 小时降雨', '未來 2 小時降雨', 'Rain next 2 hours'],
  'now.updated': ['更新于 {t}', '更新於 {t}', 'updated {t}'],
  'now.empty': ['暂无临近预报数据，请稍后刷新', '暫無臨近預報數據，請稍後刷新', 'No nowcast yet — refresh later'],
  'now.footnote': ['天文台雷达外推，每 12 分钟更新。0-2 小时内最可信赖的预报。', '天文台雷達外推，每 12 分鐘更新。0-2 小時內最可信賴的預報。', 'HKO radar extrapolation, every 12 min. The most trusted source for 0–2h.'],

  // --- hourly bars ---
  'hourly.title': ['逐小时降水概率（未来 48 小时）', '逐小時降水概率（未來 48 小時）', 'Hourly rain chance (next 48h)'],
  'hourly.source': ['Open-Meteo 集合预报', 'Open-Meteo 集合預報', 'Open-Meteo ensemble'],
  'hourly.empty': ['暂无逐小时预报数据，请稍后刷新', '暫無逐小時預報數據，請稍後刷新', 'No hourly data yet — refresh later'],
  'hourly.official': ['官方预报', '官方預報', 'Official'],
  'hourly.corrected': ['按实测校正后', '按實測校正後', 'Corrected'],
  'hourly.clim': ['十年同期', '十年同期', 'Past 10y'],
  'hourly.suggest': ['建议：{z}', '建議：{z}', 'Advice: {z}'],
  'hourly.comfort': ['打球舒适度', '打球舒適度', 'Comfort'],
  'hourly.footer': ['雨量 {mm}mm · 风 {w}km/h', '雨量 {mm}mm · 風 {w}km/h', 'rain {mm}mm · wind {w}km/h'],
  'hourly.atemp': [' · 体感 {t}°C', ' · 體感 {t}°C', ' · feels {t}°C'],
  'hourly.hum': [' · 湿度 {h}%', ' · 濕度 {h}%', ' · humidity {h}%'],
  'hourly.noStats': [' · 校正数据积累中，黑点暂等于官方值', ' · 校正數據積累中，黑點暫等於官方值', ' · correction building; dot ≈ official'],
  'hourly.legendGo': ['放心', '放心', 'go'],
  'hourly.legendEdge': ['边缘', '邊緣', 'border'],
  'hourly.legendNo': ['别赌', '别赌', 'no'],
  'hourly.tip': ['看颜色拿结论，点柱子看三个数和细节。黑点比蓝条低 = 预报历史上偏乐观，按黑点算。', '看顏色拿結論，點柱看三個數和細節。黑點比藍條低 = 預報歷史上偏樂觀，按黑點算。', 'Read the colour; tap a bar for the three numbers. Dot below the bar = forecasts run optimistic here — trust the dot.'],
  'hourly.tipOfficial': ['官方概率 {p}%', '官方概率 {p}%', 'official {p}%'],
  'hourly.tipCorrected': ['校正后 {p}%', '校正後 {p}%', 'corrected {p}%'],
  'hourly.tipClim': ['十年同期 {p}%', '十年同期 {p}%', 'past-10y {p}%'],
  'hourly.tipZone': ['建议：{z}', '建議：{z}', 'advice: {z}'],
  'hourly.vGo': ['三个数都低：这一小时可以放心', '三個數都低：這一小時可以放心', 'All three low: this hour looks safe'],
  'hourly.vGoTail': ['，不过历史上这个时间有 {c}% 在下雨，别完全按惯例排除', '，不過歷史上這個時間有 {c}% 在下雨，別完全按慣例排除', ', though it has rained {c}% of this hour historically — not impossible'],
  'hourly.vClimWin': ['预报和校正后都偏高（{o}%→{c}%），但历史上这个时间只有 {cl}% 在下雨——更像短期天气过程，过去就过去了', '預報和校正後都偏高（{o}%→{c}%），但歷史上這個時間只有 {cl}% 在下雨——更像短期天氣過程，過去就過去了', 'Forecast and corrected both high ({o}%→{c}%), but only {cl}% historically at this hour — likely a passing system'],
  'hourly.vWet': ['校正后 {c}%，下雨是大概率事件，这个时段不建议硬打', '校正後 {c}%，下雨是大概率事件，這個時段不建議硬打', 'Corrected {c}% — rain is likely; better not to force this slot'],
  'hourly.vEdge': ['校正后 {c}%，属于五五开的边缘时段：能改就改，要打就盯紧临近预报', '校正後 {c}%，屬於五五開的邊緣時段：能改就改，要打就盯緊臨近預報', 'Corrected {c}% — a coin-flip slot: reschedule if you can, else watch the nowcast'],
  'hourly.vLow': ['官方 {o}%、校正后 {c}%，风险不高', '官方 {o}%、校正後 {c}%，風險不高', 'Official {o}%, corrected {c}% — low risk'],

  // --- score card ---
  'score.title': ['预报可信吗？（近 {n} 天）', '預報可信嗎？（近 {n} 天）', 'Can you trust the forecasts? (last {n}d)'],
  'score.explain': ['「雨量站实测」= 天文台最近测站自动核对；「球友上报」= 到场球友众包核对。漏报率高要防突发降雨；误报率高可以放心赌一把。样本不足 {m} 时显示 —。', '「雨量站實測」= 天文台最近測站自動核對；「球友上報」= 到場球友眾包核對。漏報率高要防突發降雨；誤報率高可以放心賭一把。樣本不足 {m} 時顯示 —。', '"Gauge" = auto-checked against the nearest HKO station; "Players" = crowd-checked by courtside reports. High miss rate: watch for surprise rain. High false-alarm rate: safe to play the odds. Shown as — under {m} samples.'],
  'score.gauge': ['雨量站实测', '雨量站實測', 'Gauge'],
  'score.players': ['球友上报', '球友上報', 'Players'],
  'score.omTitle': ['Open-Meteo 逐小时概率', 'Open-Meteo 逐小時概率', 'Open-Meteo hourly chance'],
  'score.omNote': ['中期预报（2-48小时）· 非官方', '中期預報（2-48小時）· 非官方', 'Medium range (2–48h) · unofficial'],
  'score.f3Title': ['天文台临近预报', '天文台臨近預報', 'HKO nowcast'],
  'score.f3Note': ['雷达外推（0-2小时）· 官方', '雷達外推（0-2小時）· 官方', 'Radar extrapolation (0–2h) · official'],
  'score.miss': ['漏报{p}', '漏報{p}', 'miss {p}'],
  'score.far': ['误报{p}', '誤報{p}', 'false {p}'],

  // --- persistence ---
  'persist.title': ['下雨了等多久？没下能顶多久？', '下雨了等幾耐？沒下能頂多久？', 'Raining — wait it out? Dry — will it hold?'],
  'persist.subtitle': ['基于该区十年 {m} 月实测（≥0.5mm 口径），回答你打球时最常问的两个问题', '基於該區十年 {m} 月實測（≥0.5mm 口徑），回答你打球時最常問的兩個問題', 'From 10 years of local {m}-month data (≥0.5mm): answers to the two questions players ask most'],
  'persist.dryLead': ['现在没下雨就出门打 2 小时：', '現在沒下雨就出門打 2 小時：', 'Dry now, playing 2 hours:'],
  'persist.dryHi': ['全程无雨——这个季节的干爽时段很稳', '全程無雨——這個季節的乾爽時段很穩', 'stay dry — dry windows are reliable this season'],
  'persist.dryMid': ['全程无雨，可以安排', '全程無雨，可以安排', 'stay dry — go for it'],
  'persist.dryLo': ['全程无雨——这个时段雨说来就来，看紧临近预报', '全程無雨——這個時段雨說來就來，看緊臨近預報', 'stay dry — rain arrives suddenly here; watch the nowcast'],
  'persist.wetLead': ['正在下雨？', '正在下雨？', 'Raining now?'],
  'persist.wetHi': ['的雨在一小时内会停——可以先热身等一等', '的雨在一小時內會停——可以先熱身等一等', 'of these showers stop within an hour — warm up and wait'],
  'persist.wetMid': ['的雨在一小时内会停——五五开，赌前看眼雷达', '的雨在一小時內會停——五五開，賭前看眼雷達', 'stop within an hour — a coin flip; glance at the radar first'],
  'persist.wetLo': ['的雨在一小时内会停——这个季节的雨很能下，考虑改期', '的雨在一小時內會停——這個季節的雨很能下，考慮改期', 'stop within an hour — this season rains long; consider rescheduling'],
  'persist.wetTail': ['（{m} 月历史）', '（{m} 月歷史）', ' ({m} history)'],

  // --- report sheet ---
  'report.title': ['我就在这个球场', '我就在這個球場', "I'm at this court"],
  'report.note': ['只有在球场 500 米内才能上报；每次上报间隔 2 小时。', '只有在球場 500 米內才能上報；每次上報間隔 2 小時。', 'Reports only accepted within 500 m of the court; one per 2 hours.'],
  'report.cooldownLeft': ['（冷却中，剩余 {t}）', '（冷卻中，剩餘 {t}）', '(cooling down, {t} left)'],
  'report.cooling': ['冷却中', '冷卻中', 'Cooling'],
  'report.cta': ['上报实况', '上報實況', 'Report rain'],
  'report.ok': ['上报成功，谢谢！{t}内无需重复上报。', '上報成功，謝謝！{t}內無需重複上報。', 'Thanks for reporting! No need again for {t}.'],
  'report.geoFail': ['定位失败：请允许定位权限，并在空旷处重试。', '定位失敗：請允許定位權限，並在空曠處重試。', 'Location failed: allow access and retry in the open.'],
  'report.noGeo': ['设备不支持定位', '設備不支援定位', 'Location unsupported'],
  'report.hours': ['{h} 小时 {m} 分钟', '{h} 小時 {m} 分鐘', '{h}h {m}m'],
  'report.minutes': ['{m} 分钟', '{m} 分鐘', '{m} min'],

  // --- subscribe box ---
  'sub.title': ['下雨风险提醒', '下雨風險提醒', 'Rain-risk reminder'],
  'sub.note': ['到你设定的开打时间前 30 分钟，若该时段降水概率 ≥50% 或临近预报有雨则提醒你。', '到你設定的開打時間前 30 分鐘，若該時段降水概率 ≥50% 或臨近預報有雨則提醒你。', '30 min before your play time, we ping you if the chance is ≥50% or the nowcast shows rain.'],
  'sub.cta': ['开打前30分钟提醒我', '開打前30分鐘提醒我', 'Remind me 30 min before'],
  'sub.busy': ['订阅中…', '訂閱中…', 'Subscribing…'],
  'sub.pushOk': ['已订阅推送提醒：开打前 30 分钟若有下雨风险会通知你（即使页面已关闭）。', '已訂閱推送提醒：開打前 30 分鐘若有下雨風險會通知你（即使頁面已關閉）。', 'Push subscribed: notified 30 min before if rain risk shows (even when closed).'],
  'sub.poll': ['当前环境连不上推送服务，已改用页面内提醒：到点前请保持本站页面打开，会弹出系统通知或页内横幅。', '當前環境連不上推送服務，已改用頁面內提醒：到點前請保持本站頁面打開，會彈出系統通知或頁內橫幅。', 'Push service unreachable; using in-page reminders — keep this site open for a notification or banner.'],
  'sub.noPerm': ['未获得通知权限', '未取得通知權限', 'Notification permission denied'],
  'sub.noServer': ['服务器未配置推送', '伺服器未設定推送', 'Push not configured'],

  // --- check-in ---
  'check.title': ['今天在这里打了', '今天在這裡打了', 'Played here today'],
  'check.note': ['打卡只进你的个人战报（不参与公共评分）；之后自动回顾那天的天气', '打卡只進你的個人戰報（不參與公共評分）；之後自動回顧那天的天氣', "Check-ins go to your personal log only (never public scores); we recap that day's weather afterwards"],
  'check.cta': ['打卡', '打卡', 'Check in'],
  'check.half': ['半小时', '半小時', '30 min'],
  'check.one': ['1 小时', '1 小時', '1 h'],
  'check.two': ['2 小时', '2 小時', '2 h'],
  'check.done': ['已记入你的战报，去「洞察」页看回顾', '已記入你的戰報，去「洞察」頁看回顧', 'Logged! See the recap on the Insights tab'],

  // --- recent reports ---
  'recent.title': ['球友最近上报', '球友最近上報', 'Recent player reports'],
  'recent.empty': ['近 3 小时没人报。你在球场？顺手报一个', '近 3 小時沒人報。你在球場？順手報一個', 'No reports in the last 3h. At a court? Tap one in.'],
  'recent.ago': ['{m} 分钟前', '{m} 分鐘前', '{m} min ago'],
  'recent.agoH': ['{h} 小时前', '{h} 小時前', '{h}h ago'],

  // --- my report card ---
  'mr.title': ['我的战报', '我的戰報', 'My match log'],
  'mr.totalN': ['共 {n} 场', '共 {n} 場', '{n} total'],
  'mr.empty': ['打完球在球场页点「打卡」，这里会用本站实测档案自动回顾：哪几场全程无雨、哪场预报说不会下却被淋（漏网之鱼）、哪场你顶着预报赌赢了。', '打完球在球場頁點「打卡」，這裡會用本站實測檔案自動回顧：哪幾場全程無雨、哪場預報說不會下卻被淋（漏網之魚）、哪場你頂著預報賭贏了。', 'Tap "Check in" on a court page after playing; we recap each session against our own records — all-dry runs, ambushes (forecast said no, you got soaked), and times you bet against the forecast and won.'],
  'mr.statTotal': ['总场次', '總場次', 'Sessions'],
  'mr.statRain': ['遇雨场次', '遇雨場次', 'Rain hit'],
  'mr.statWin': ['赌赢次数', '賭贏次數', 'Bet wins'],
  'mr.tag.win': ['赌赢', '賭贏', 'Won bet'],
  'mr.tag.clean': ['稳稳的', '穩穩的', 'All dry'],
  'mr.tag.ambush': ['漏网之鱼', '漏網之魚', 'Ambushed'],
  'mr.tag.hit': ['有言在先', '有言在先', 'Forecast warned'],
  'mr.recover': ['换手机/清过数据？用通行码找回战报', '換手機/清過數據？用通行碼找回戰報', 'New phone / cleared data? Recover with your passcode'],
  'mr.codeCurrent': ['当前通行码（复制保存）：', '當前通行碼（複製保存）：', 'Your passcode (copy & keep):'],
  'mr.codePlaceholder': ['在新设备输入旧通行码认领', '在新設備輸入舊通行碼認領', 'Enter old passcode to claim'],
  'mr.claim': ['认领', '認領', 'Claim'],
  'mr.claimed': ['已认领（{c} 次打卡 · {r} 次上报），刷新后生效', '已認領（{c} 次打卡 · {r} 次上報），刷新後生效', 'Claimed ({c} check-ins · {r} reports) — reload to apply'],
  'mr.noRecord': ['这个码名下没有记录，请检查输入', '這個碼名下沒有記錄，請檢查輸入', 'No records under this code — check it'],

  // --- reminders ---
  'remind.title': ['球场下雨风险提醒', '球場下雨風險提醒', 'Court rain-risk reminder'],
  'remind.riskyText': ['{name}：{hhmm} 前后降水概率约 {p}%，留意场地情况', '{name}：{hhmm} 前後降水概率約 {p}%，留意場地情況', '{name}: ~{p}% rain chance around {hhmm} — check court conditions'],
  'remind.okText': ['{name}：{hhmm} 时段目前无雨风险，放心打球 ☀️', '{name}：{hhmm} 時段目前無雨風險，放心打球 ☀️', '{name}: no rain risk around {hhmm} — enjoy ☀️'],
  'remind.banner': ['{hhmm} 提醒', '{hhmm} 提醒', '{hhmm} reminder'],
  'remind.riskyBody': ['降水概率约 {p}%，出门前再看一眼临近预报', '降水概率約 {p}%，出門前再看一眼臨近預報', '~{p}% rain chance — check the nowcast before leaving'],
  'remind.okBody': ['该时段目前无雨风险', '該時段目前無雨風險', 'No rain risk for this slot'],
  'remind.close': ['关闭', '關閉', 'Close'],
  'remind.view': ['查看球场天气 →', '查看球場天氣 →', 'Court weather →'],

  // --- best page / rain map ---
  'best.pick': ['选时段，看全港哪个球场最稳', '選時段，看全港哪個球場最穩', 'Pick an hour, find the driest court'],
  'best.tomorrow': ['明天', '明天', 'Tmrw'],
  'best.hour': ['{hh}点', '{hh}點', '{hh}:00'],
  'best.city': ['市区{p}%', '市區{p}%', 'city {p}%'],
  'best.wetBanner': ['这个时段全市都偏湿（中位 {p}%）', '這個時段全市都偏濕（中位 {p}%）', 'Whole city looks wet this hour (median {p}%)'],
  'best.wetBetter': ['——更稳的是 {hours}', '——更穩的是 {hours}', ' — steadier at {hours}'],
  'best.official': ['官方 {p}% · {z}', '官方 {p}% · {z}', 'official {p}% · {z}'],
  'best.footnote': ['按校正后概率升序（校正 = 用近 30 天实测表现换算官方预报）。前 20 名展示，点卡片看球场详情。', '按校正後概率升序（校正 = 用近 30 天實測表現換算官方預報）。前 20 名展示，點卡片看球場詳情。', 'Sorted by corrected chance (official forecast rescaled by 30-day real performance). Top 20 shown; tap for details.'],
  'map.title': ['雨团现在在哪', '雨團現在哪', "Where's the rain"],
  'map.subtitle': ['这一条回答：雨离我多远、往哪边走', '這一條回答：雨離我多遠、往哪邊走', 'How far is the rain, and where is it heading?'],
  'map.updated': ['{n} 分钟前更新 · 每 12 分钟', '{n} 分鐘前更新 · 每 12 分鐘', 'Updated {n} min ago · every 12 min'],
  'map.fullBadge': ['⤢ 全屏', '⤢ 全螢幕', '⤢ Full'],
  'map.openAria': ['放大雨团地图', '放大雨團地圖', 'Open rain map full screen'],
  'map.hint': ['双指缩放 · 拖动平移 · 双击放大', '雙指縮放 · 拖動平移 · 雙擊放大', 'Pinch to zoom · drag to pan · double-tap'],
  'map.reset': ['⟲ 复位', '⟲ 復位', '⟲ Reset'],
  'map.close': ['✕ 完成', '✕ 完成', '✕ Done'],
  'map.closeAria': ['关闭全屏', '關閉全螢幕', 'Close full screen'],
  'map.legendDry': ['球场无雨', '球場無雨', 'dry'],
  'map.legendWet': ['球场有雨', '球場有雨', 'wet'],
  'map.legendRain': ['雨(半小时mm)', '雨(半小時mm)', 'mm/30min'],
  'map.step0': ['+30分', '+30分', '+30m'],
  'map.step1': ['+1时', '+1時', '+1h'],
  'map.step2': ['+1.5时', '+1.5時', '+1.5h'],
  'map.step3': ['+2时', '+2時', '+2h'],
  'map.nearest': ['💡 离你最近的雨团在{dir}方向约 {km} 公里', '💡 離你最近的雨團在{dir}方向約 {km} 公里', '💡 Nearest rain is ~{km} km to your {dir}'],
  'map.near': ['——就在附近，出门前盯紧临近预报', '——就在附近，出門前盯緊臨近預報', ' — right nearby; watch the nowcast before leaving'],
  'map.mid': ['——还有段距离，留意移向', '——還有段距離，留意移向', ' — some distance away; watch its movement'],
  'map.far': ['——暂时威胁不大', '——暫時威脅不大', ' — no immediate threat'],
  'map.locate': ['看雨离我多远', '看雨離我多遠', 'How far is the rain?'],
  'map.locating': ['定位中…', '定位中…', 'Locating…'],
  'map.located': ['已定位', '已定位', 'Located'],
  'map.footnote': ['由本站每 12 分钟抓取的天文台全港降雨临近预报网格自绘；蓝格越深雨越大（浅蓝≈0.1、深蓝≥5 毫米/半小时）。点"看雨离我多远"需要在手机上允许定位；点地图可全屏缩放。', '由本站每 12 分鐘抓取的天文台全港降雨臨近預報網格自繪；藍格越深雨越大（淺藍≈0.1、深藍≥5 毫米/半小時）。點「看雨離我多遠」需要在手機上允許定位；點地圖可全螢幕縮放。', 'Drawn from the HKO gridded rainfall nowcast we fetch every 12 min; darker blue = heavier (light ≈0.1, dark ≥5 mm/30min). Locate needs permission; tap the map for full screen.'],

  // --- insights ---
  'ins.guideTitle': ['📊 这页是什么？怎么读？（点开 30 秒入门）', '📊 這頁是什麼？怎麼讀？（點開 30 秒入門）', '📊 What is this page? (30-second primer)'],
  'ins.guide1': ['1. 本站持续把"预报当时怎么说的"存档，和"实际下没下"自动对账——这页就是对账结果。', '1. 本站持續把「預報當時怎麼說的」存檔，和「實際下沒下」自動對賬——這頁就是對賬結果。', '1. We archive what each forecast said and reconcile it with what actually happened — this page is the ledger.'],
  'ins.guide2': ['2. 每个数字都带样本量 n：n 越小越会抖，别把小样本的数字当真理；显示"积累中"就是还不够。', '2. 每個數字都帶樣本量 n：n 越小越會抖，別把小樣本的數字當真理；顯示「積累中」就是還不夠。', '2. Every number carries its sample size n: small n wobbles — ignore it; "building up" means not enough yet.'],
  'ins.guide3': ['3. 和"历史平均"比的分数（BSS）才是真本事：因为香港本来就不常下雨，闭眼说"没雨"也能蒙对 88%。', '3. 和「歷史平均」比的分數（BSS）才是真本事：因為香港本來就不常下雨，閉眼說「沒雨」也能蒙對 88%。', '3. Skill vs the historical average (BSS) is what counts: Hong Kong is so dry that blindly saying "no rain" scores 88%.'],
  'ins.omTitle': ['Open-Meteo 逐小时概率预报', 'Open-Meteo 逐小時概率預報', 'Open-Meteo hourly probability'],
  'ins.omQuestion': ['中期预报（2-48 小时）到底有没有用', '中期預報（2-48 小時）到底有沒有用', 'Do medium-range (2–48h) forecasts actually help?'],
  'ins.f3Title': ['天文台临近预报（0-2 小时）', '天文台臨近預報（0-2 小時）', 'HKO nowcast (0–2h)'],
  'ins.f3Question': ['出门前最该信的那份雷达预报表现如何', '出門前最該信的那份雷達預報表現如何', 'How good is the radar forecast you check before leaving?'],
  'ins.window': ['近 {n} 天 · n={n2}', '近 {n} 天 · n={n2}', 'last {n}d · n={n2}'],
  'ins.bss': ['比「只看历史平均」聪明多少（BSS）', '比「只看歷史平均」聰明多少（BSS）', 'Beats the historical average? (BSS)'],
  'ins.bssNa': ['不适用', '不適用', 'N/A'],
  'ins.bssNaNote': ['确定性预报没有概率可打分', '確定性預報沒有概率可打分', 'Deterministic forecasts have no probability to score'],
  'ins.bssPos': ['同样的信息量，比直接翻历史账本准 {p}%', '同樣的信息量，比直接翻歷史賬本準 {p}%', '{p}% more accurate than just reading the odds'],
  'ins.bssNeg': ['暂时还不如直接翻历史账本', '暫時還不如直接翻歷史賬本', 'Not yet better than the historical odds'],
  'ins.acc': ['说下雨时准不准（准确率）', '說下雨時準不準（準確率）', 'Overall accuracy'],
  'ins.baseNote': ['基准：闭眼全说"没雨"也能对 {x}%——准确率要跑赢它才算真本事', '基準：閉眼全說「沒雨」也能對 {x}%——準確率要跑贏它才算真本事', 'Baseline: always saying "no rain" scores {x}% — accuracy must beat that to mean anything'],
  'ins.accNote': ['n={n} 小时样本', 'n={n} 小時樣本', 'n={n} hourly samples'],
  'ins.miss': ['漏报率 {v}', '漏報率 {v}', 'miss rate {v}'],
  'ins.far': ['误报率 {v} ({a}~{b}%)', '誤報率 {v} ({a}~{b}%)', 'false alarms {v} ({a}~{b}%)'],
  'ins.heidke': ['Heidke {v}', 'Heidke {v}', 'Heidke {v}'],
  'ins.peirce': ['Peirce {v}', 'Peirce {v}', 'Peirce {v}'],
  'ins.brier': ['Brier {v}', 'Brier {v}', 'Brier {v}'],
  'ins.onset': ['突发雨捕获 {p}（{n} 次）', '突發雨捕獲 {p}（{n} 次）', 'Sudden-rain catch {p} ({n} onsets)'],
  'ins.decLine': ['误差拆解：数字虚高 {r} · 能区分下不下 {res} · 天气本身的随机 {u}（这个季节 {b} 的小时在下雨）', '誤差拆解：數字虛高 {r} · 能區分下不下 {res} · 天氣本身的隨機 {u}（這個季節 {b} 的小時在下雨）', "Error split: inflation {r} · discrimination {res} · nature's noise {u} ({b} of hours rain this season)"],
  'ins.decLegend': ['红=报大话的损失（越少越好） 蓝=真本事（越多越好） 灰=老天爷的随机（谁也消不掉）', '紅=報大話的損失（越少越好） 藍=真本事（越多越好） 灰=老天爺的隨機（誰也消不掉）', "Red = inflation loss (lower better) · blue = real skill · grey = nature's noise"],
  'ins.relTitle': ['它说的 60%，实际是 60% 吗？', '它說的 60%，實際是 60% 嗎？', 'It says 60% — is it really 60%?'],
  'ins.relQuestion': ['预报的数字本身可不可信', '預報的數字本身可不可信', 'Whether the forecast numbers themselves are trustworthy'],
  'ins.reliable': ['预报数字与实际基本一致，可以按面值相信', '預報數字與實際基本一致，可以按面值相信', 'Numbers match reality — take them at face value'],
  'ins.inflated': ['预报普遍虚高：平均说的比实际多约 {d} 个百分点（如说 60% 实际约 {r}%）', '預報普遍虛高：平均說的比實際多約 {d} 個百分點（如說 60% 實際約 {r}%）', 'Forecasts run high: on average ~{d} pts above reality (say 60% → reality ~{r}%)'],
  'ins.conservative': ['预报普遍保守：实际比说的更爱下雨约 {d} 个百分点', '預報普遍保守：實際比說的更愛下雨約 {d} 個百分點', 'Forecasts run low: reality rains ~{d} pts more than claimed'],
  'ins.axisX': ['预报说的% →', '預報說的% →', 'forecast said % →'],
  'ins.axisY': ['↑ 实际下的%', '↑ 實際下的%', '↑ actually rained %'],
  'ins.relLegend': ['点落在虚线上=说到做到；整体在虚线下方=爱报大话；气泡越大=这个区间的样本越多。', '點落在虛線上=說到做到；整體在虛線下方=愛報大話；氣泡越大=這個區間的樣本越多。', 'On the dashed line = honest; below it = runs hot; bigger bubble = more samples.'],
  'ins.decayTitle': ['提前多久看的预报才算数？', '提前多久看的預報才算數？', 'How far ahead can you trust it?'],
  'ins.decayQuestion': ['隔天的预报能不能信？提前订场该看哪份？', '隔天的預報能不能信？提前訂場該看哪份？', 'Can you trust tomorrow\'s forecast? Which one to book by?'],
  'ins.bucket.l3': ['临出门看', '臨出門看', 'Just before'],
  'ins.bucket.l12': ['当天安排', '當天安排', 'Same day'],
  'ins.bucket.l24': ['明天订场', '明天訂場', 'Book tomorrow'],
  'ins.bucket.l48': ['提前两天', '提前兩天', 'Two days out'],
  'ins.hourTitle': ['几点钟的预报最容易骗你？', '幾點鐘的預報最容易騙你？', 'Which hours fool you most?'],
  'ins.hourQuestion': ['哪些时段的"没雨"要留个心眼（漏报 = 实际下了，预报却说不会）', '哪些時段的「沒雨」要留個心眼（漏報 = 實際下了，預報卻說不會）', 'Hours where "no rain" deserves suspicion (miss = it rained although none was forecast)'],
  'ins.rankTitle': ['哪个球场的预报最靠谱？', '哪個球場的預報最靠譜？', "Which court's forecasts score best?"],
  'ins.rankQuestion': ['同样是预报，哪个球场骗人少一点', '同樣是預報，哪個球場騙人少一點', 'Same forecasts — where are you less likely to be fooled?'],
  'ins.rankExplain': ['横条是可信范围（95% 置信区间），竖线是估计值。两条横条有重叠 = 这两个球场没有实际差别，别纠结名次。全港平均 {p}。样本少的球场已自动向平均靠拢。', '橫條是可信範圍（95% 置信區間），豎線是估計值。兩條橫條有重疊 = 這兩個球場沒有實際差別，別糾經名次。全港平均 {p}。樣本少的球場已自動向平均靠攏。', "Bars are 95% confidence intervals; the vertical line is the estimate. Overlapping bars = no real difference — don't fuss over rank. City average {p}. Low-sample courts shrink toward the mean."],
  'ins.micro': ['微气候球场', '微氣候球場', 'microclimate court'],
  'ins.bss.neg': ['不如查日历', '不如查日曆', 'Worse than odds'],
  'ins.bss.low': ['勉强有用', '勉強有用', 'Slightly useful'],
  'ins.bss.mid': ['有价值', '有價值', 'Useful'],
  'ins.bss.high': ['很有价值', '很有價值', 'Very useful'],
  'ins.hourEvents': ['雨事件 {n}', '雨事件 {n}', '{n} rain events'],
  'ins.trendTitle': ['预报最近准不准？', '預報最近準不準？', 'Better or worse lately?'],
  'ins.trendQuestion': ['最近两周，预报比之前准了还是飘了', '最近兩週，預報比之前準了還是飄了', 'Has the last week or two been sharper or sloppier?'],
  'ins.trend30': ['30 天', '30 天', '30d'],
  'ins.trend90': ['90 天', '90 天', '90d'],
  'ins.trend180': ['180 天', '180 天', '180d'],
  'ins.trendRolling': ['7 天滚动准确率（线）· 每日准确率（点，可点按）', '7 天滾動準確率（線）· 每日準確率（點，可點按）', '7-day rolling accuracy (line) · daily (dots, tappable)'],
  'ins.trendDetail': ['{d}：准确率 {a}% · Brier {b} · n={n}（7 天滚动 {r}%）', '{d}：準確率 {a}% · Brier {b} · n={n}（7 天滾動 {r}%）', '{d}: accuracy {a}% · Brier {b} · n={n} (7-day {r}%)'],
  'ins.trendUp': ['💡 最近 7 天比全期均值高 {p} 个百分点——预报最近更准了', '💡 最近 7 天比全期均值高 {p} 個百分點——預報最近更準了', '💡 Last 7 days beat the window average by {p} pts — sharper lately'],
  'ins.trendDown': ['💡 最近 7 天比全期均值低 {p} 个百分点——最近有点飘', '💡 最近 7 天比全期均值低 {p} 個百分點——最近有點飄', '💡 Last 7 days trail the window average by {p} pts — wobbling'],
  'ins.trendFlat': ['💡 最近 7 天与全期均值基本持平', '💡 最近 7 天與全期均值基本持平', '💡 Last 7 days roughly match the window average'],
  'ins.trendEmpty': ['样本还在积累中', '樣本還在積累中', 'Samples still building'],
  'ins.dryTitle': ['哪些球场天生干燥？', '哪些球場天生乾燥？', 'Which courts are naturally dry?'],
  'ins.dryQuestion': ['同样一场雨，哪片场地天生更干（十年气候底数，与预报无关）', '同樣一場雨，哪片場地天生更乾（十年氣候底數，與預報無關）', 'Same rain, different courts: the built-in 10-year dryness ranking (forecast-independent)'],
  'ins.dryMonth': ['本月', '本月', 'This month'],
  'ins.dryYear': ['全年', '全年', 'Year-round'],
  'ins.dryTop': ['最干 Top 10', '最乾 Top 10', 'Driest 10'],
  'ins.wetTop': ['最湿 Top 5', '最濕 Top 5', 'Wettest 5'],
  'ins.dryNote': ['十年 ERA5 档案 · ≥0.5mm 口径 · 约 11km 网格，同区球场数值相同。全港均值 {p}。', '十年 ERA5 檔案 · ≥0.5mm 口徑 · 約 11km 網格，同區球場數值相同。全港均值 {p}。', '10y ERA5 archive · ≥0.5mm · ~11km grid, same-area courts tie. City average {p}.'],
  'ins.dryDiff': ['比均值干 {p} 点', '比均值乾 {p} 點', '{p} pts drier'],
  'ins.wetDiff': ['比均值湿 {p} 点', '比均值濕 {p} 點', '{p} pts wetter'],
  'ins.disTitle': ['两个预报打架时听谁的？', '兩個預報打架時聽誰的？', 'When the two forecasts disagree?'],
  'ins.disQuestion': ['两个预报说法相反时，历史上谁更常对', '兩個預報說法相反時，歷史上誰更常對', 'When the two forecasts disagree, who has been right?'],
  'ins.disAgree': ['两源一致时准确率', '兩源一致時準確率', 'Accuracy when they agree'],
  'ins.disN': ['打架次数', '打架次數', 'Disagreements'],
  'ins.disOmWet': ['Open-Meteo 报雨 · 临近预报说干', 'Open-Meteo 報雨 · 臨近預報說乾', 'OM says rain · nowcast says dry'],
  'ins.disF3Wet': ['临近预报报雨 · Open-Meteo 说干', '臨近預報報雨 · Open-Meteo 說乾', 'Nowcast says rain · OM says dry'],
  'ins.disHitRate': ['报对 {p}% · n={n}', '報對 {p}% · n={n}', 'right {p}% · n={n}'],
  'ins.disOm': ['Open-Meteo', 'Open-Meteo', 'Open-Meteo'],
  'ins.disF3': ['临近预报', '臨近預報', 'Nowcast'],
  'ins.disBothRate': ['{a} 对 {x}% · {b} 对 {y}%', '{a} 對 {x}% · {b} 對 {y}%', '{a} right {x}% · {b} right {y}%'],
  'ins.disVerdictOm': ['💡 打架时更多是 Open-Meteo 对：{p}% 的分歧场次它报对（n={n}）', '💡 打架時更多是 Open-Meteo 對：{p}% 的分歧場次它報對（n={n}）', '💡 Open-Meteo wins more disagreements: right in {p}% of them (n={n})'],
  'ins.disVerdictF3': ['💡 打架时更多是临近预报对：{p}% 的分歧场次它报对（n={n}）', '💡 打架時更多是臨近預報對：{p}% 的分歧場次它報對（n={n}）', '💡 The nowcast wins more disagreements: right in {p}% of them (n={n})'],
  'ins.disVerdictTie': ['💡 两源打架时胜负各半，没有明显该信谁', '💡 兩源打架時勝負各半，沒有明顯該信誰', '💡 Disagreements split evenly — no clear winner'],

  // --- home (landing page) ---
  'home.heroTitle': ['香港网球人的天气助手', '香港網球人的天氣助手', "Hong Kong tennis players' weather companion"],
  'home.heroSub': ['出门前看哪片场无雨，到了球场顺手报个天况。报的人越多，大家猜得越准。', '出門前看哪片場無雨，到了球場順手報個天況。報的人越多，大家猜得越準。', "Check which courts stay dry before you leave; drop a quick report when you're there. The more of us report, the better we all read the sky."],
  'home.ctaCourts': ['查看球场天气', '查看球場天氣', 'Browse courts'],
  'home.ctaReport': ['我现在就在球场', '我現在就在球場', "I'm at a court now"],
  'home.locating': ['定位中…', '定位中…', 'Locating…'],
  'home.geoFail': ['定位没成功，先去列表选球场吧', '定位沒成功，先去列表選球場吧', 'Location failed — pick your court from the list'],
  'home.statCourts': ['片公共网球场', '片公共網球場', 'public courts'],
  'home.statReports': ['条实况上报', '條實況上報', 'field reports'],
  'home.statMedian': ['未来一小时全港中位降雨概率', '未來一小時全港中位降雨概率', 'city median rain chance, next hour'],
  'home.statCheckins': ['次打球打卡', '次打球打卡', 'check-ins'],
  'home.whatTitle': ['这是什么？30 秒了解', '這是什麼？30 秒了解', 'What is this? (30 seconds)'],
  'home.step1Title': ['① 出门前：看预报', '① 出門前：看預報', '① Before you go: forecasts'],
  'home.step1Body': ['逐小时降雨概率、雨团实时地图，时段按稳不稳排好。挑球场、挑时段，不用再猜。', '逐小時降雨概率、雨團實時地圖，時段按穩不穩排好。挑球場、挑時段，不用再猜。', 'Hourly rain odds, a live rain-cluster map, and slots ranked by how steady they are. No more guessing.'],
  'home.step2Title': ['② 到场后：报实况', '② 到場後：報實況', '② At the court: report'],
  'home.step2Body': ['没雨、小雨还是大雨？点一下就行。你眼前这片天，就是最新的实况。', '沒雨、小雨還是大雨？點一下就行。你眼前這片天，就是最新的實況。', "No rain, light or pouring? One tap and you're done. The sky above you is the freshest data there is."],
  'home.step3Title': ['③ 越用越准：自动对账', '③ 越用越準：自動對賬', '③ Sharper every week: auto-verified'],
  'home.step3Body': ['预报说会下、实际下了没，我们自动记账。哪家预报靠得住，看数据就知道。', '預報說會下、實際下了沒，我們自動記賬。哪家預報靠得住，看數據就知道。', 'What each forecast promised versus what actually fell, tallied automatically. You see exactly which source to trust.'],
  'home.pulseTitle': ['刚刚有球友上报', '剛剛有球友上報', 'Fresh from the courts'],
  'home.pulseEmpty': ['近 6 小时没人报。去球场，做今天第一个？', '近 6 小時沒人報。去球場，做今天第一個？', 'Quiet for the last 6h. Be the first to report today.'],
  'home.callTitle': ['你看到的天气，正是别人想知道的', '你看到的天氣，正是別人想知道的', 'The sky you see is the one others are wondering about'],
  'home.callBody': ['这里没有商业数据源，天气靠球友一条条报出来。你顺手一报，正纠结去不去的人心里就有数了。', '這裡沒有商業數據源，天氣靠球友一條條報出來。你順手一報，正糾結去不去的人心裡就有數了。', "There's no paid data feed here — courts are read by players, one report at a time. Yours might settle it for someone still hesitating by the door."],

  // --- admin dashboard (/admin, token-gated) ---
  'admin.title': ['后台管理', '後台管理', 'Admin'],
  'admin.subtitle': ['数据与运营看板 · 仅管理员可见', '數據與營運看板 · 僅管理員可見', 'Ops dashboard · admin only'],
  'admin.tokenLabel': ['管理令牌', '管理令牌', 'Admin token'],
  'admin.tokenHint': ['即环境变量 ADMIN_TOKEN 的值', '即環境變數 ADMIN_TOKEN 的值', 'The ADMIN_TOKEN environment variable'],
  'admin.tokenPlaceholder': ['粘贴管理令牌', '貼上管理令牌', 'Paste the admin token'],
  'admin.enter': ['进入看板', '進入看板', 'Enter'],
  'admin.entering': ['验证中…', '驗證中…', 'Verifying…'],
  'admin.tokenInvalid': ['令牌不正确，请重试', '令牌不正確，請重試', 'Invalid token — try again'],
  'admin.tokenNotConfigured': ['服务器还没设置 ADMIN_TOKEN：本地加到 backend/.env，线上加到 Railway 环境变量，重启后生效', '伺服器還沒設定 ADMIN_TOKEN：本地加到 backend/.env，線上加到 Railway 環境變數，重啟後生效', 'ADMIN_TOKEN is not set on the server — add it to backend/.env locally or to Railway variables, then restart.'],
  'admin.logout': ['退出', '登出', 'Sign out'],
  'admin.refresh': ['刷新', '重新整理', 'Refresh'],
  'admin.loadFail': ['加载失败：{msg}', '載入失敗：{msg}', 'Load failed: {msg}'],
  'admin.updatedAgo': ['更新于 {t}前 · 每 60 秒自动刷新', '更新於 {t}前 · 每 60 秒自動刷新', 'Updated {t} ago · auto-refreshes every 60s'],
  'admin.uptime': ['服务已运行 {t}', '服務已運行 {t}', 'Up {t}'],
  'admin.ago': ['{t}前', '{t}前', '{t} ago'],
  'admin.t.sec': ['{n} 秒', '{n} 秒', '{n}s'],
  'admin.t.min': ['{n} 分钟', '{n} 分鐘', '{n} min'],
  'admin.t.hour': ['{n} 小时', '{n} 小時', '{n}h'],
  'admin.t.day': ['{n} 天', '{n} 天', '{n}d'],
  'admin.freshnessTitle': ['数据抓取', '資料擷取', 'Data ingestion'],
  'admin.freshnessNote': ['每个数据源最新一条数据距现在多久。绿=按时；黄=略迟；红=停滞，去服务端日志查原因。', '每個數據源最新一條數據距現在多久。綠=按時；黃=略遲；紅=停滯，去伺服器日誌查原因。', 'Age of the newest record per source. Green = on schedule; amber = late; red = stalled — check server logs.'],
  'admin.source.nowcast': ['雨团临近预报 · 每 12 分钟', '雨團臨近預報 · 每 12 分鐘', 'Nowcast F3 · every 12 min'],
  'admin.source.rainfall': ['雨量站观测 · 每 15 分钟', '雨量站觀測 · 每 15 分鐘', 'Gauge rainfall · every 15 min'],
  'admin.source.current': ['当前天气 · 每 15 分钟', '現時天氣 · 每 15 分鐘', 'Current weather · every 15 min'],
  'admin.source.forecast': ['逐小时预报 · 每 60 分钟', '逐小時預報 · 每 60 分鐘', 'Hourly forecast · every 60 min'],
  'admin.noData': ['尚无数据', '尚無數據', 'no data yet'],
  'admin.jobsTitle': ['定时任务', '定時任務', 'Scheduled jobs'],
  'admin.job.ingest_nowcast': ['抓取临近预报', '擷取臨近預報', 'Ingest nowcast'],
  'admin.job.ingest_rainfall': ['抓取雨量观测', '擷取雨量觀測', 'Ingest rainfall'],
  'admin.job.ingest_current': ['抓取当前天气', '擷取現時天氣', 'Ingest current weather'],
  'admin.job.ingest_open_meteo': ['抓取逐小时预报', '擷取逐小時預報', 'Ingest hourly forecast'],
  'admin.job.push_check': ['推送提醒检查', '推送提醒檢查', 'Push reminder check'],
  'admin.job.purge': ['清理过期数据', '清理過期數據', 'Purge old rows'],
  'admin.job.climate_update': ['气候统计回填', '氣候統計回填', 'Climatology top-up'],
  'admin.jobNever': ['本次启动后还没跑过', '本次啟動後還沒跑過', 'not run since boot'],
  'admin.jobRunning': ['运行中…', '運行中…', 'running…'],
  'admin.jobStat': ['{runs} 次 · 失败 {fails} · 用时 {dur}', '{runs} 次 · 失敗 {fails} · 用時 {dur}', '{runs} runs · {fails} failed · took {dur}'],
  'admin.jobNext': ['下次还有 {t}', '下次還有 {t}', 'next in {t}'],
  'admin.reportsTitle': ['今日上报', '今日上報', "Today's reports"],
  'admin.stat.total': ['总上报', '總上報', 'Total'],
  'admin.stat.accepted': ['已采纳', '已採納', 'Accepted'],
  'admin.stat.rejected': ['被拒', '被拒', 'Rejected'],
  'admin.reason.rejected_accuracy': ['定位精度不足', '定位精度不足', 'GPS accuracy'],
  'admin.reason.rejected_geofence': ['不在球场范围', '不在球場範圍', 'Outside geofence'],
  'admin.reason.rejected_cooldown': ['冷却期内', '冷卻期內', 'Cooldown'],
  'admin.reason.rejected_speed': ['移速异常', '移速異常', 'Implausible speed'],
  'admin.reason.rejected_daily_limit': ['超每日上限', '超每日上限', 'Daily limit'],
  'admin.reason.rejected_bad_data': ['数据异常', '數據異常', 'Bad data'],
  'admin.trendTitle': ['近 7 天采纳上报', '近 7 天採納上報', 'Accepted reports, last 7 days'],
  'admin.recentTitle': ['最新上报（含被拒）', '最新上報（含被拒）', 'Latest reports (incl. rejected)'],
  'admin.filter.all': ['全部', '全部', 'All'],
  'admin.filter.accepted': ['已采纳', '已採納', 'Accepted'],
  'admin.filter.rejected': ['被拒', '被拒', 'Rejected'],
  'admin.emptyReports': ['还没有上报记录', '還沒有上報記錄', 'No reports yet'],
  'admin.distance': ['距球场 {m} 米', '距球場 {m} 米', '{m} m from court'],
  'admin.usersTitle': ['用户活跃', '用戶活躍', 'User activity'],
  'admin.stat.checkinsToday': ['今日打卡', '今日打卡', 'Check-ins today'],
  'admin.stat.checkins7d': ['7 天打卡', '7 天打卡', 'Check-ins, 7d'],
  'admin.stat.checkinsTotal': ['累计打卡', '累計打卡', 'Check-ins total'],
  'admin.stat.devices7d': ['7 天活跃设备', '7 天活躍設備', 'Active devices, 7d'],
  'admin.stat.subPush': ['推送订阅', '推送訂閱', 'Push subs'],
  'admin.stat.subPoll': ['轮询订阅', '輪詢訂閱', 'Polling subs'],
  'admin.dbTitle': ['数据库', '資料庫', 'Database'],
  'admin.dbNote': ['「创建于」突然变成刚刚 = 重部署把存储卷弄丢了，数据清零，去 Railway 检查 /data 卷挂载。', '「建立於」突然變成剛剛 = 重部署把儲存卷弄丟了，數據清零，去 Railway 檢查 /data 卷掛載。', 'If "created" jumps to just now, the redeploy lost the volume and the DB reset — check the /data volume mount on Railway.'],
  'admin.dbSize': ['文件大小 {v} MB', '檔案大小 {v} MB', 'Size {v} MB'],
  'admin.dbCreated': ['创建于 {t}', '建立於 {t}', 'Created {t}'],
  'admin.latestObservation': ['最新雨量观测：{t}', '最新雨量觀測：{t}', 'Latest gauge obs: {t}'],
  'admin.dbUnavailable': ['数据库状态不可用', '數據庫狀態不可用', 'DB state unavailable'],
  'admin.activityTitle': ['活跃趋势', '活躍趨勢', 'Activity trends'],
  'admin.activity7': ['7 天', '7 天', '7d'],
  'admin.activity30': ['30 天', '30 天', '30d'],
  'admin.activity90': ['90 天', '90 天', '90d'],
  'admin.dauTitle': ['每日活跃设备（上报或打卡过）', '每日活躍設備（上報或打卡過）', 'Daily active devices (reported or checked in)'],
  'admin.hourTitle': ['上报提交时刻分布', '上報提交時刻分佈', 'Report submissions by hour'],
  'admin.funnelTotal': ['窗口内总上报', '窗口內總上報', 'Reports in window'],
  'admin.subsCreated': ['窗口内新订阅', '窗口內新訂閱', 'New subs in window'],
  'admin.table.courts': ['球场', '球場', 'Courts'],
  'admin.table.forecast_snapshots': ['预报快照', '預報快照', 'Forecast snapshots'],
  'admin.table.observations': ['雨量观测行', '雨量觀測行', 'Observations'],
  'admin.table.nowcast_snapshots': ['临近预报快照', '臨近預報快照', 'Nowcast snapshots'],
  'admin.table.climatology_cells': ['气候格', '氣候格', 'Climatology cells'],
  'admin.table.user_reports_total': ['上报（全部）', '上報（全部）', 'Reports (all)'],
  'admin.table.accepted_user_reports': ['上报（已采纳）', '上報（已採納）', 'Reports (accepted)'],
  'admin.table.checkins': ['打卡', '打卡', 'Check-ins'],
  'admin.table.push_subscriptions': ['提醒订阅', '提醒訂閱', 'Subscriptions'],
} as const;

export type TKey = keyof typeof S;

export const WEEKDAYS: Record<Lang, readonly string[]> = {
  hans: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  hant: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

// Server-side error details that users may see verbatim → translate the known ones.
const SERVER_KEYS: Record<string, TKey> = {
  '同球场 6 小时内已打卡过': 'server.checkinCooldown',
};

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem('wh_lang');
    if (saved === 'hans' || saved === 'hant' || saved === 'en') return saved;
  } catch { /* private mode */ }
  const langs = [navigator.language, ...(navigator.languages ?? [])];
  for (const l of langs) {
    const low = l.toLowerCase();
    if (/^(zh-(tw|hk|mo)|yue)/.test(low)) return 'hant';
    if (low.startsWith('en')) return 'en';
    if (low.startsWith('zh')) return 'hans';
  }
  return 'hans';
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

export type TFn = (key: TKey, params?: Record<string, string | number>) => string;

const Ctx = createContext<LangCtx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    const meta = LANG_META.find((m) => m.id === lang);
    document.documentElement.lang = meta?.htmlLang ?? 'zh-Hans';
    document.title = {
      hans: '网球天气助手 · 香港球场降雨预报与实况验证',
      hant: '網球天氣助手 · 香港球場降雨預報與實況驗證',
      en: 'Tennis Weather HK · Rain forecasts for HK courts, verified',
    }[lang];
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('wh_lang', l); } catch { /* private mode */ }
  };

  const t = useCallback((key: TKey, params?: Record<string, string | number>): string => {
    let s: string = S[key][IDX[lang]];
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        s = s.replaceAll(`{${k}}`, String(v));
      }
    }
    return s;
  }, [lang]);

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLang outside LangProvider');
  return v;
}

export function useT() {
  return useLang().t;
}

/** Pick the display name / district of a court for the active language. */
export function courtName(
  c: { name_sc: string; name_tc: string; name_en: string }, lang: Lang,
): string {
  return lang === 'en' ? c.name_en : lang === 'hant' ? c.name_tc : c.name_sc;
}

export function districtName(d_tc: string, d_en: string, lang: Lang): string {
  return lang === 'en' ? d_en : d_tc;
}

/** Localised comfort note from level + numbers (the server note is zh-Hans only). */
export function comfortNote(
  t: TFn, level: string | null | undefined,
  atemp: number | null | undefined, wind: number | null | undefined,
): string {
  if (level !== 'good' && level !== 'fair' && level !== 'poor' && level !== 'severe') {
    return t('comfort.noData');
  }
  const key = `comfort.${level}` as TKey;
  let note = t(key, { t: atemp != null ? Math.round(atemp) : '—' });
  if (wind != null && wind >= 25) note += ' · ' + t('comfort.windy', { w: Math.round(wind) });
  return note;
}

export function serverMsg(msg: string, t: TFn): string {
  const key = SERVER_KEYS[msg];
  return key ? t(key) : msg;
}
