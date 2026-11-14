import type { Lang } from './i18n';

const COPY = {
  planTitle: ['这一场，怎么安排', '這一場，怎樣安排', 'Plan this session'],
  planHint: ['选开打时间和时长，只看你这一场。全部时间为香港时间。', '選開打時間和時長，只看你這一場。全部時間為香港時間。', 'Choose your start and duration. All times are Hong Kong time.'],
  start: ['整点开打', '整點開打', 'Start on the hour'],
  duration: ['打多久', '打多久', 'Duration'],
  hours: ['{n} 小时', '{n} 小時', '{n} hour(s)'],
  today: ['今天', '今天', 'Today'],
  tomorrow: ['明天', '明天', 'Tomorrow'],
  low: ['降雨风险较低', '降雨風險較低', 'Lower rain risk'],
  edge: ['留好备选安排', '留好備選安排', 'Keep a backup plan'],
  high: ['建议换个时段', '建議換個時段', 'Consider a different time'],
  unknown: ['暂时无法判断', '暫時無法判斷', 'Not enough fresh data'],
  warning: ['先查看天气警告', '先查看天氣警告', 'Check the weather warnings first'],
  lowBody: ['所选时段的各小时风险均较低；出发前再看一次雷达和场地实况。', '所選時段的各小時風險均較低；出發前再看一次雷達和場地實況。', 'All covered hours show lower rain risk. Check radar and court conditions again before leaving.'],
  edgeBody: ['这一场包含中等风险时段，可准备室内或改期方案。', '這一場包含中等風險時段，可準備室內或改期方案。', 'This session includes moderate rain risk. Have an indoor or rescheduling option ready.'],
  highBody: ['这一场包含较高风险时段，下面可直接比较每个小时。', '這一場包含較高風險時段，下面可直接比較每個小時。', 'This session includes a higher-risk hour. Compare the hourly breakdown below.'],
  warningBody: ['目前有生效警告或本区对地闪电记录。先阅读上方警告，再决定是否进行户外活动。', '目前有生效警告或本區對地閃電紀錄。先閱讀上方警告，再決定是否進行戶外活動。', 'A current warning or local cloud-to-ground lightning record is present. Read the warnings above before deciding on outdoor play.'],
  missing: ['所选时段缺少预报，不能把缺数据当成没雨。', '所選時段缺少預報，不能把缺數據當成沒雨。', 'Forecast data is missing for this session. Missing data does not mean dry weather.'],
  partial: ['预报未覆盖整场，暂不提供低风险结论。', '預報未覆蓋整場，暫不提供低風險結論。', 'The forecast does not cover the whole session. A lower-risk verdict is unavailable.'],
  stale: ['部分预报已超过 3 小时，或更新时间无法确认。刷新后再作决定。', '部分預報已超過 3 小時，或更新時間無法確認。重新整理後再作決定。', 'Some forecasts are over 3 hours old, or their update time is unknown. Refresh before deciding.'],
  offline: ['当前离线，以下只保留上次数据。联网刷新后再判断是否适合开打。', '目前離線，以下只保留上次數據。連線重新整理後再判斷是否適合開打。', 'You are offline. Only previously loaded data is shown. Reconnect and refresh before deciding whether to play.'],
  past: ['这个开打时间已经过去，请选下一个时段。', '這個開打時間已經過去，請選下一個時段。', 'This start time has passed. Choose a later slot.'],
  pastLabel: ['已过去', '已過去', 'Passed'],
  peak: ['峰值 {n}/100', '峰值 {n}/100', 'Peak {n}/100'],
  peakHint: ['按整场中最高的单小时风险判断，不是整场下雨概率。', '按整場中最高的單小時風險判斷，不是整場下雨機率。', 'Uses the highest hourly risk in the session, not the probability of rain at any time during it.'],
  method: ['风险值优先使用雷达、校正预报与气候基线的启发式融合；没有融合值时采用校正预报。0–30 为较低，31–60 为中等，61–100 为较高。融合值尚未经独立概率校准。', '風險值優先使用雷達、校正預報與氣候基線的啟發式融合；沒有融合值時採用校正預報。0–30 為較低，31–60 為中等，61–100 為較高。融合值尚未經獨立機率校準。', 'Risk uses a heuristic blend of radar, calibrated forecasts and climate where available; otherwise it uses the calibrated forecast. 0–30 is lower, 31–60 moderate and 61–100 higher. The blended index has not been independently probability-calibrated.'],
  methodTitle: ['这个风险值怎么读？', '這個風險值怎麼讀？', 'How should I read this index?'],
  noSlots: ['暂无可选开打时段', '暫無可選開打時段', 'No start times available'],
  coverage: ['已覆盖 {n}/{total} 个小时', '已覆蓋 {n}/{total} 個小時', '{n}/{total} hours covered'],
  sourceTime: ['预报更新 {time} HKT', '預報更新 {time} HKT', 'Forecast updated {time} HKT'],
  timeUnknown: ['预报更新时间未提供', '預報更新時間未提供', 'Forecast update time unavailable'],
  staleLabel: ['旧数据', '舊數據', 'Outdated'],
  missingLabel: ['缺数据', '缺數據', 'No data'],
  refresh: ['刷新天气', '重新整理天氣', 'Refresh weather'],
  refreshing: ['更新中…', '更新中…', 'Refreshing…'],
  refreshFailed: ['暂时无法更新，保留上次数据。请稍后重试。', '暫時無法更新，保留上次數據。請稍後再試。', 'Unable to refresh. The last loaded data is shown; please try again.'],
  retry: ['重新加载', '重新載入', 'Try again'],
  detailFailed: ['天气暂时无法加载', '天氣暫時無法載入', 'Weather could not be loaded'],
  nowcastStale: ['雷达数据已过期，或更新时间无法确认。以下仅为上次记录，不能判断未来 2 小时是否无雨。', '雷達數據已過期，或更新時間無法確認。以下僅為上次紀錄，不能判斷未來 2 小時是否無雨。', 'Radar data is outdated or its freshness is unknown. These are previous records, not a dry-weather outlook for the next 2 hours.'],
  radarFresh: ['雷达已更新', '雷達已更新', 'Radar updated'],
  radarStale: ['雷达待更新', '雷達待更新', 'Radar needs updating'],
  radarMissing: ['雷达暂无数据', '雷達暫無數據', 'Radar unavailable'],
  staleHourly: ['这一小时的数据已过期，不能据此判断适合开打。', '這一小時的數據已過期，不能據此判斷適合開打。', 'This hourly forecast is outdated. Do not use it to decide whether to play.'],
  fusedLabel: ['融合风险指数', '融合風險指數', 'Blended risk index'],
  chartNote: ['柱形为预报概率，琥珀点为融合风险指数；两者含义不同。全部时间为香港时间。', '柱形為預報機率，琥珀點為融合風險指數；兩者含義不同。全部時間為香港時間。', 'Bars are forecast probabilities; amber dots are a blended risk index. They have different meanings. All times are Hong Kong time.'],
} as const;

type CopyKey = keyof typeof COPY;
export function detailCopy(lang: Lang, key: CopyKey, values: Record<string, string | number> = {}): string {
  let text: string = COPY[key][lang === 'hans' ? 0 : lang === 'hant' ? 1 : 2];
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
