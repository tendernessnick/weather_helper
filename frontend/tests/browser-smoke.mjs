/** Local browser regression with deterministic API fixtures. No live writes.
 * Build first: npm --prefix frontend run build (preview starts automatically)
 * Run: node frontend/tests/browser-smoke.mjs
 * Override WEATHER_BASE_URL / PLAYWRIGHT_MODULE / BROWSER_CHANNEL if needed.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.WEATHER_BASE_URL || 'http://127.0.0.1:8145';
const output = fileURLToPath(new URL('../../.zcode/qa/', import.meta.url));
await mkdir(output, { recursive: true });
const fixedNow = Date.parse('2026-11-14T04:15:00Z'); // 12:15 HKT
const hourMs = 3_600_000;
const hk = (timestamp) => new Date(timestamp + 8 * hourMs).toISOString().slice(0, 19);
const firstHour = Math.floor(fixedNow / hourMs) * hourMs + hourMs;
const issuedAt = hk(fixedNow - 5 * 60_000);
const courts = [
  { id: 'victoria', name_en: 'Victoria Park Tennis Courts', name_tc: '維多利亞公園網球場', name_sc: '维多利亚公园网球场', district_en: 'Wan Chai', district_tc: '灣仔區', letter: 'V', lat: 22.282, lon: 114.189 },
  { id: 'kowloon', name_en: 'Kowloon Park Tennis Courts', name_tc: '九龍公園網球場', name_sc: '九龙公园网球场', district_en: 'Yau Tsim Mong', district_tc: '油尖旺區', letter: 'K', lat: 22.3, lon: 114.17 },
  { id: 'tsingyi', name_en: 'Tsing Yi Tennis Courts', name_tc: '青衣網球場', name_sc: '青衣网球场', district_en: 'Kwai Tsing', district_tc: '葵青區', letter: 'T', lat: 22.35, lon: 114.1 },
].map((court) => ({ ...court, address_tc: '測試地址', address_en: 'Fixture address', court_no: '6', opening_hours: '07:00–23:00', phone: '12345678', nowcast: { fetched_at: issuedAt, max_mm: 0, rain: false }, score: null }));

function freshness(status = 'fresh', maxAge = 180) {
  return { status, fetched_at: status === 'missing' ? null : status === 'stale' ? hk(fixedNow - 4 * hourMs) : issuedAt, age_minutes: status === 'missing' ? null : status === 'stale' ? 240 : 5, max_age_minutes: maxAge };
}

function weather(mode = 'fresh') {
  let hourly = Array.from({ length: 24 }, (_, i) => ({ hour: hk(firstHour + i * hourMs), fetched_at: mode === 'stale' ? hk(fixedNow - 4 * hourMs) : issuedAt, stale: mode === 'stale', pop: i === 1 ? 85 : 15, corrected_pop: i === 1 ? 75 : 20, zone: i === 1 ? 'no' : 'go', ...(i < 6 ? { fused_pop: i === 1 ? 80 : 20, fused_swirls: i < 2 } : {}), mm: i === 1 ? 1 : 0, weather_code: 2, wind_kmh: 10, apparent_temp: 25, humidity: 70, comfort: { level: 'good', note: '' } }));
  if (mode === 'missing') hourly = [];
  if (mode === 'partial') hourly = hourly.filter((_, i) => i !== 1);
  return { court_id: 'victoria', data_status: { timezone: 'Asia/Hong_Kong', generated_at: `${hk(fixedNow)}+08:00`, nowcast: freshness(mode === 'stale' ? 'stale' : 'fresh', 25), hourly: freshness(mode === 'missing' ? 'missing' : mode === 'stale' ? 'stale' : 'fresh') }, nowcast: { fetched_at: mode === 'stale' ? hk(fixedNow - 4 * hourMs) : issuedAt, steps: [1, 2, 3, 4].map((n) => ({ ending: hk(fixedNow + n * 30 * 60_000), mm: 0 })) }, hourly, calibration: { basis_n: 0 }, current: null, warnings: mode === 'warning' ? ['Fixture thunderstorm warning'] : [], lightning: null, persistence: null, sources: {} };
}

function best(hour) {
  const selected = hour || hk(firstHour);
  return { hour: selected, city_median_pop: 20, courts: courts.map((court) => ({ ...court, court_id: court.id, pop: 20, corrected_pop: 20, zone: 'go' })), hours: Array.from({ length: 18 }, (_, i) => ({ hour: hk(firstHour + i * hourMs), city_median_pop: 20 + i })), data_status: freshness(), available_courts: 3, total_courts: 3, timezone: 'Asia/Hong_Kong', generated_at: `${hk(fixedNow)}+08:00` };
}

async function installFixtures(page, state) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() !== 'GET') {
      state.posts.push({ path: url.pathname, body: request.postDataJSON() });
      return send({ status: 'ok', mode: 'polling' });
    }
    if (url.pathname === '/api/courts') { state.courtReads++; return state.failCourts ? send({detail:'fixture unavailable'},503) : send({ total: courts.length, courts: state.unknownCourt ? courts.map(c => ({...c, nowcast:null})) : courts }); }
    if (url.pathname === '/api/courts/victoria/weather') {
      if (state.failWeather) return send({ detail: 'fixture unavailable' }, 503);
      return send(weather(state.weather));
    }
    if (url.pathname === '/api/courts/victoria') return send({ ...courts[0], scores: null });
    if (url.pathname.endsWith('/calibration')) return send({ detail: 'insufficient samples' }, 503);
    if (url.pathname === '/api/reports/status') return send({ cooldown_remaining_sec: 0, reports_today: 0, daily_limit: 10 });
    if (url.pathname.endsWith('/reports/recent') || url.pathname === '/api/reports/latest') return send({ reports: [] });
    if (url.pathname === '/api/push/public-key') return send({ enabled: false, public_key: null });
    if (url.pathname === '/api/reminders/check') {
      const reminders = state.reminders.splice(0);
      return send({ reminders });
    }
    if (url.pathname === '/api/health') return send({ status: 'ok', db: { courts: 3, user_reports_total: 0, checkins: 0 } });
    if (url.pathname === '/api/best') {
      if (state.failBest) return send({detail:'fixture unavailable'},503);
      const hour = url.searchParams.get('hour');
      if (state.bestDelays && hour) await new Promise((resolve) => setTimeout(resolve, hour.endsWith('14:00:00') ? 350 : 30));
      const result = best(hour);
      if (state.emptyBest) { result.courts=[]; result.city_median_pop=null; result.available_courts=0; result.data_status=freshness('missing'); }
      return send(result);
    }
    if (url.pathname === '/api/map/rain') return send({ fetched_at: state.mapStale ? hk(fixedNow - 4*hourMs) : issuedAt, steps: [1, 2, 3, 4].map((n) => ({ ending: hk(fixedNow + n * 30 * 60_000), cells: [] })) });
    if (url.pathname === '/api/checkins/report') return send({ total: 0, rain_sessions: 0, gamble_wins: 0, sessions: [] });
    if (url.pathname === '/api/feedback/status') return send({ cooldown_remaining_sec: 0, feedback_today: 0, daily_limit: 5 });
    return send({ detail: `Unmocked ${url.pathname}` }, 503);
  });
}

let server;
async function reachable() { try { return (await fetch(base)).ok; } catch { return false; } }
if (!await reachable()) {
  const address = new URL(base);
  assert(['127.0.0.1', 'localhost'].includes(address.hostname), 'Auto-start only supports localhost');
  server = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'preview', '--host', address.hostname, '--port', address.port, '--strictPort'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'ignore', windowsHide: true });
  process.once('exit', () => server?.kill());
  for (let attempt = 0; attempt < 40 && !await reachable(); attempt++) await new Promise((resolve) => setTimeout(resolve, 500));
  assert(await reachable(), 'Preview server did not start; run npm run build first');
}

const report = { checks: [], pageErrors: [], capturedAt: new Date().toISOString() };
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
async function contextFor(lang = 'en', timezoneId = 'Asia/Hong_Kong', width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, locale: lang === 'en' ? 'en-GB' : lang === 'hant' ? 'zh-HK' : 'zh-CN', timezoneId, permissions: ['notifications'], serviceWorkers: 'block' });
  await context.addInitScript((language) => { localStorage.setItem('wh_lang', language); }, lang);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.clock.install({ time: fixedNow });
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  const state = { courtReads: 0, failCourts: false, failBest: false, emptyBest: false, mapStale: false, unknownCourt: false, weather: 'fresh', failWeather: false, bestDelays: false, posts: [], reminders: [] };
  await installFixtures(page, state);
  return { context, page, state };
}
async function check(name, fn) {
  try { await fn(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, passed: false, error: String(error) }); console.error(`FAIL ${name}: ${error}`); }
}

try {
  await check('3 languages × 4 widths: list navigation and horizontal layout', async () => {
    for (const lang of ['hans', 'hant', 'en']) {
      const { context, page } = await contextFor(lang);
      try {
        await page.goto(`${base}/courts`);
        await page.locator('main a[href="/courts/victoria"]').waitFor();
        for (const width of [320, 390, 768, 1280]) {
          await page.setViewportSize({ width, height: 844 });
          const sizes = await page.evaluate(() => ({ view: innerWidth, page: document.documentElement.scrollWidth }));
          assert(sizes.page <= sizes.view, `${lang}/${width}: overflow ${JSON.stringify(sizes)}`);
          const links = page.locator('header a[href="/courts"], header a[href="/best"], header a[href="/insights"]');
          assert.equal(await links.count(), 3);
          for (const link of await links.all()) {
            const box = await link.boundingBox();
            assert(box && box.x >= 0 && box.x + box.width <= width, `${lang}/${width}: clipped navigation`);
          }
        }
        if (lang === 'en') {
          await page.screenshot({ path: `${output}/court-list-desktop.png` });
          await page.setViewportSize({width:390,height:844});
          await page.screenshot({ path: `${output}/court-list-mobile.png` });
        }
      } finally { await context.close(); }
    }
  });

  await check('saved courts persist and district/search filters combine', async () => {
    const { context, page } = await contextFor();
    try {
      await page.goto(`${base}/courts`);
      await page.getByRole('button', { name: 'Save court', exact: true }).first().click();
      await page.getByRole('button', { name: /^★?\s*Saved/ }).click();
      await expect(page.locator('main a[href^="/courts/"]')).toHaveCount(1);
      await page.reload();
      await page.getByRole('button', { name: 'Remove from favourites', exact: true }).waitFor();
      await expect(page.locator('main a[href^="/courts/"]')).toHaveCount(1);
    } finally { await context.close(); }
  });

  await check('planner uses selected duration and blocks stale/missing/partial verdicts', async () => {
    const { context, page, state } = await contextFor();
    try {
      await page.goto(`${base}/courts/victoria`);
      const planner = page.locator('section[aria-labelledby="play-plan-title"]');
      await planner.getByText('Consider a different time', { exact: true }).waitFor();
      await planner.getByRole('button', { name: '1 hour(s)', exact: true }).click();
      await planner.getByText('Lower rain risk', { exact: true }).waitFor();
      for (const mode of ['stale', 'missing', 'partial']) {
        state.weather = mode;
        await page.reload();
        await planner.getByText('Not enough fresh data', { exact: true }).waitFor();
        assert.equal(await planner.getByText('Lower rain risk', { exact: true }).count(), 0, mode);
      }
      state.weather = 'warning';
      await page.reload();
      await planner.getByText('Check the weather warnings first', { exact: true }).waitFor();
      await page.screenshot({ path: `${output}/planner-warning-mobile.png` });
    } finally { await context.close(); }
  });

  await check('subscription defaults and posted times stay Hong Kong time in both zones', async () => {
    const values = [];
    for (const timezone of ['Asia/Hong_Kong', 'America/Phoenix']) {
      const { context, page, state } = await contextFor('en', timezone);
      try {
        await page.goto(`${base}/courts/victoria`);
        const input = page.getByLabel('Play time · Hong Kong time (UTC+8)', { exact: true });
        await input.waitFor();
        values.push(await input.inputValue());
        await input.fill('');
        await page.getByRole('button', { name: 'Remind me 30 min before', exact: true }).click();
        await page.getByText('Choose a valid future play time in Hong Kong time.', { exact: true }).waitFor();
        assert.equal(state.posts.length, 0);
        await input.fill('2026-11-14T13:30');
        await page.getByRole('button', { name: 'Remind me 30 min before', exact: true }).click();
        await page.getByText(/In-page reminder set/).waitFor();
        assert.equal(state.posts.length, 1);
        assert.equal(state.posts[0].path, '/api/subscriptions/polling');
        assert.equal(state.posts[0].body.play_at, '2026-11-14T13:30');
      } finally { await context.close(); }
    }
    assert.deepEqual(values, ['2026-11-14T13:00', '2026-11-14T13:00']);
  });

  await check('Best discards an older response and recovers from errors and missing forecasts', async () => {
    const { context, page, state } = await contextFor();
    try {
      state.bestDelays = true;
      await page.goto(`${base}/best`);
      const chips = page.locator('main button[aria-pressed]');
      await chips.nth(1).click();
      await chips.nth(2).click();
      const links = page.locator('main a[href^="/courts/"]');
      await links.first().waitFor();
      assert((await links.first().getAttribute('href')).includes(encodeURIComponent(hk(firstHour+2*hourMs))));
      await new Promise(resolve => setTimeout(resolve,450));
      assert((await links.first().getAttribute('href')).includes(encodeURIComponent(hk(firstHour+2*hourMs))));
      state.failBest = true;
      await page.getByRole('button', {name:'Refresh',exact:true}).click();
      await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
      assert.equal(await links.count(),0);
      state.failBest = false;
      await page.getByRole('button',{name:'Try again',exact:true}).click();
      await links.first().waitFor();
      state.emptyBest = true;
      await page.getByRole('button',{name:'Refresh',exact:true}).click();
      await page.getByText(/No fresh forecasts for this time/).waitFor();
      assert.equal(await links.count(),0);
    } finally { await context.close(); }
  });

  await check('long-open rankings expire before suggesting a court', async () => {
    const { context, page } = await contextFor();
    try {
      await page.goto(`${base}/best`);
      await page.locator('main button[aria-pressed]').nth(5).click();
      const links = page.locator('main a[href^="/courts/"]');
      await links.first().waitFor();
      await page.clock.fastForward(181*60_000);
      await page.getByText(/No fresh forecasts for this time/).waitFor();
      assert.equal(await links.count(),0);
    } finally { await context.close(); }
  });

  await check('list can retry and filters combine locally without extra requests', async () => {
    const { context, page, state } = await contextFor();
    try {
      state.failCourts = true;
      await page.goto(`${base}/courts`);
      await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
      state.failCourts = false;
      await page.getByRole('button',{name:'Try again',exact:true}).click();
      await page.locator('main a[href="/courts/victoria"]').waitFor();
      const requestCount = state.courtReads;
      await page.getByRole('searchbox').fill('park');
      await page.getByRole('combobox',{name:'Filter district'}).selectOption('Wan Chai');
      await expect(page.locator('main a[href^="/courts/"]')).toHaveCount(1);
      await page.getByRole('searchbox').fill('no such court');
      await page.getByText('No matching courts', {exact:true}).waitFor();
      await page.getByRole('button',{name:'Clear filters',exact:true}).click();
      await expect(page.locator('main a[href^="/courts/"]')).toHaveCount(3);
      assert.equal(state.courtReads,requestCount);
    } finally { await context.close(); }
  });

  await check('unknown reminders and missing radar dots never imply no rain', async () => {
    const { context, page, state } = await contextFor();
    try {
      await context.clearPermissions();
      state.reminders.push({court_id:'victoria',court_name:'Victoria',court_name_en:'Victoria',play_hhmm:'13:00',risky:null,pop:null,risk_status:'unknown'});
      await page.goto(base);
      await page.getByText(/Forecast missing or out of date/).waitFor();
      state.mapStale = true;
      state.unknownCourt = true;
      await page.goto(`${base}/best`);
      await page.getByText(/Rain map unavailable or out of date/).waitFor();
      const dots = page.locator('circle[data-court-id]');
      assert.equal(await dots.count(),3);
      for (const dot of await dots.all()) assert.equal(await dot.getAttribute('fill'),'#94A3B8');
    } finally { await context.close(); }
  });

  await check('offline planner and elapsed radar validity remove low risk advice', async () => {
    const { context, page } = await contextFor();
    try {
      await page.goto(`${base}/courts/victoria`);
      const planner = page.locator('section[aria-labelledby="play-plan-title"]');
      await planner.getByRole('button',{name:'1 hour(s)',exact:true}).click();
      await planner.getByText('Lower rain risk',{exact:true}).waitFor();
      await context.setOffline(true);
      await planner.getByText('Not enough fresh data',{exact:true}).waitFor();
      await context.setOffline(false);
      await planner.getByText('Lower rain risk',{exact:true}).waitFor();
      await page.clock.runFor(26 * 60_000);
      await planner.getByText('Not enough fresh data',{exact:true}).waitFor();
    } finally { await context.close(); }
  });

  await check('home, ranking and planner: 3 languages × 4 widths, no overflow or missing names', async () => {
    for (const lang of ['hans','hant','en']) {
      const {context,page}=await contextFor(lang);
      try {
        for (const path of ['/','/best','/courts/victoria']) {
          await page.goto(base+path);
          await page.locator('main h1').waitFor();
          if (path.includes('victoria')) await page.locator('#play-plan-title').waitFor();
          for (const width of [320,390,768,1280]) {
            await page.setViewportSize({width,height:844});
            assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),`${path}/${lang}/${width}`);
          }
          if (lang==='hans') {
            await page.setViewportSize({width:390,height:844});
            if(path.includes('victoria')) {
              await page.locator('#play-plan-title').scrollIntoViewIfNeeded();
              await page.screenshot({path:`${output}/planner-zh-mobile.png`});
            }
          }
          if (lang==='en') {
            const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).disableRules(['color-contrast']).analyze();
            assert.deepEqual(axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),[]);
          }
        }
      } finally {await context.close();}
    }
  });

  assert.deepEqual(report.pageErrors, [], 'unhandled browser errors');
} finally {
  await writeFile(`${output}/browser-smoke.json`, JSON.stringify(report, null, 2));
  await browser.close();
  server?.kill();
}
if (report.checks.some((entry) => !entry.passed) || report.pageErrors.length) process.exitCode = 1;
