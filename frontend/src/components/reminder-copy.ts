import type { Lang } from '../i18n';

const copy = {
  hans: {
    timeLabel: '开打时间 · 香港时间（UTC+8）',
    invalidTime: '请选择有效的未来开打时间（香港时间）。',
    polling: '已设为页面内提醒。请保持本站页面打开；关闭页面后无法提醒。',
    unknown: '预报缺失或已过期，暂时无法判断雨风险。出门前请刷新球场天气。',
    dry: '当前预报雨风险较低，出门前请再看临近预报与官方警告。',
    radarRain: '临近预报显示有雨，请留意场地情况。',
  },
  hant: {
    timeLabel: '開打時間 · 香港時間（UTC+8）',
    invalidTime: '請選擇有效的未來開打時間（香港時間）。',
    polling: '已設為頁面內提醒。請保持本站頁面開啟；關閉頁面後無法提醒。',
    unknown: '預報缺失或已過期，暫時無法判斷雨風險。出門前請重新整理球場天氣。',
    dry: '目前預報雨風險較低，出門前請再看臨近預報與官方警告。',
    radarRain: '臨近預報顯示有雨，請留意場地情況。',
  },
  en: {
    timeLabel: 'Play time · Hong Kong time (UTC+8)',
    invalidTime: 'Choose a valid future play time in Hong Kong time.',
    polling: 'In-page reminder set. Keep this site open; reminders cannot arrive after you close it.',
    unknown: 'Forecast missing or out of date; rain risk is unknown. Refresh court weather before leaving.',
    dry: 'Current forecast suggests lower rain risk. Recheck the nowcast and official warnings before leaving.',
    radarRain: 'The nowcast shows rain. Check court conditions before leaving.',
  },
};

export function reminderCopy(lang: Lang) {
  return copy[lang];
}
