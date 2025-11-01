// scripts/build-pages.js
// Build 4 static VVX-friendly HTML pages using an external stylesheet (css/vvx.css)
//
// Features:
// - Weather (Open-Meteo, hourly updates during 06:00–22:00 local)
// - Astronomy (WeatherAPI, once per day at 06:00 local)
// - Tides (Stormglass, today + tomorrow once per day at 02:00 local)
// - Caching in data/cache.json
// - Supports force flags: FORCE_TIDES=1 FORCE_ASTRONOMY=1
// - Europe/London timezone

import fs from 'node:fs/promises';
import path from 'node:path';

// ===== CONFIG =====
const lat = 50.4;     // base location
const lng = -5.0;
const tz  = 'Europe/London';
const CACHE_PATH = 'data/cache.json';

// ===== FORCE OPTIONS =====
const FORCE_TIDES = process.env.FORCE_TIDES === '1';
const FORCE_ASTRONOMY = process.env.FORCE_ASTRONOMY === '1';

// ===== TIME HELPERS =====
const fmtParts = (d = new Date(), opts = {}) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).formatToParts(d);

const ymdLocal = (d = new Date()) => {
  const p = fmtParts(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const get = t => p.find(x => x.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const hourLocal = () => {
  const p = fmtParts(new Date(), { hour: '2-digit', hour12: false });
  return parseInt(p.find(x => x.type === 'hour')?.value || '0', 10);
};

const withinActive = () => {
  const h = hourLocal();
  return h >= 6 && h <= 22;
};

const fmtDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, day: '2-digit', month: 'short', year: 'numeric'
  }).format(d);

const fmtTime = (d) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit'
  }).format(new Date(d));

const nowStr = () =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit'
  }).format(new Date());

// ===== DISK CACHE =====
async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { weather: null, tides2d: null, astronomy: null };
  }
}
async function writeCache(cache) {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

// ===== FETCHERS =====
async function fetchWeather() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`;
  const j = await fetch(url).then(r => r.json());
  const w = j.current_weather || {};
  const c = Math.round(w.temperature ?? 0);
  const f = Math.round(c * 9 / 5 + 32);
  const kmh = Math.round(w.windspeed ?? 0);
  const mph = Math.round(kmh * 0.621371);
  const dir = Math.round(w.winddirection ?? 0);
  const map = { 0:'clear-day',1:'partly-cloudy',2:'cloudy',3:'rain',45:'fog',51:'rain',61:'rain',71:'snow',95:'thunderstorm' };
  return { c, f, kmh, mph, winddir: dir, icon: map[w.weathercode] || 'clear-day', _ts: new Date().toISOString() };
}

async function fetchAstronomy() {
  const key = process.env.WEATHERAPI_KEY;
  if (!key) return null;
  const j = await fetch(`https://api.weatherapi.com/v1/astronomy.json?key=${key}&q=Cornwall&dt=today`).then(r => r.json());
  const a = j.astronomy?.astro || {};
  const phaseName = a.moon_phase || '—';
  const phaseIcon = (phaseName.toLowerCase().replace(/\s+/g,'-')) || 'full-moon';
  return { sunrise: a.sunrise || '--:--', sunset: a.sunset || '--:--', phaseName, phaseIcon, _date: ymdLocal() };
}

async function fetchTides2Days() {
  const key = process.env.STORMGLASS_KEY;
  if (!key) return null;
  const start = new Date();
  start.setHours(0,0,0,0);
  const end = new Date(start);
  end.setDate(end.getDate() + 2);
  const url = `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${start.toISOString()}&end=${end.toISOString()}`;
  const res = await fetch(url, { headers: { Authorization: key } });
  const j = await res.json();
  const list = (j.data || []).map(t => ({
    type: t.type, time: t.time, height: Number(t.height || 0),
    ymd: ymdLocal(new Date(t.time))
  }));
  const todayKey = ymdLocal(start);
  const tomorrowRef = new Date(start); tomorrowRef.setDate(tomorrowRef.getDate()+1);
  const tomorrowKey = ymdLocal(tomorrowRef);
  const byDay = { todayKey, tomorrowKey, today: [], tomorrow: [] };
  for (const e of list) {
    if (e.ymd === todayKey) byDay.today.push(e);
    else if (e.ymd === tomorrowKey) byDay.tomorrow.push(e);
  }
  const fmtRow = e => `${e.type==='high'?'↑ High':'↓ Low'} ${fmtTime(e.time)} — ${e.height.toFixed(1)} m`;
  return {
    _date: todayKey,
    todayKey, tomorrowKey,
    todayItems: byDay.today.map(fmtRow),
    tomorrowItems: byDay.tomorrow.map(fmtRow),
    raw: byDay
  };
}

// ===== DECISION LOGIC =====
const cache = await readCache();

function shouldFetchWeather() {
  return withinActive() || !cache.weather;
}
function shouldFetchAstronomy() {
  if (FORCE_ASTRONOMY) return true;
  if (!cache.astronomy) return true;
  const today = ymdLocal();
  return hourLocal() === 6 && cache.astronomy._date !== today;
}
function shouldFetchTides2D() {
  if (FORCE_TIDES) return true;
  if (!cache.tides2d) return true;
  const today = ymdLocal();
  return hourLocal() === 2 && cache.tides2d._date !== today;
}

// ===== FETCH DATA =====
let weather = cache.weather;
if (shouldFetchWeather()) {
  try { weather = await fetchWeather(); cache.weather = weather; } catch {}
}

let astronomy = cache.astronomy;
if (shouldFetchAstronomy()) {
  try { const a = await fetchAstronomy(); if (a) { astronomy = a; cache.astronomy = a; } } catch {}
}

let tides2d = cache.tides2d;
if (shouldFetchTides2D()) {
  try { const t = await fetchTides2Days(); if (t) { tides2d = t; cache.tides2d = t; } } catch {}
}

// ===== FALLBACKS =====
if (!weather)   weather   = { c:0, f:32, kmh:0, mph:0, winddir:0, icon:'clear-day' };
if (!astronomy) astronomy = { sunrise:'--:--', sunset:'--:--', phaseName:'—', phaseIcon:'full-moon' };
if (!tides2d)   tides2d   = { todayItems:['—'], tomorrowItems:['—'], raw:{today:[],tomorrow:[]}, todayKey:ymdLocal(), tomorrowKey:ymdLocal(new Date(Date.now()+86400000)) };

await writeCache(cache);

// ===== PAGE CONTENTS =====
const stripMeridiem = (s='') => s.replace(/\s*(AM|PM)$/i, '');
const sunrise = stripMeridiem(astronomy.sunrise);
const sunset  = stripMeridiem(astronomy.sunset);

const dayLabel = (ymdStr) => {
  const [yyyy, mm, dd] = ymdStr.split('-').map(Number);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday:'short', day:'2-digit', month:'short' }).format(d);
};

const compactTide = s => s.replace(/\s*tide\s*/i,' ').replace('  ',' ').replace(' m','m');

// Weather page
const tMin = -5, tMax = 30;
const frac = Math.max(0, Math.min(1, (weather.c - tMin) / (tMax - tMin)));
const fillH = Math.round(80 * frac);
const fillY = 90 - fillH;
const windDirDeg = Math.round((weather.winddir ?? 0) % 360);

const weatherBody = `
<section class="weather">
  <div class="row">
    <div class="text-lg">${weather.c}°C / ${weather.f}°F</div>
    <img class="icon-30" src="svg/weather/${weather.icon}.svg" alt="Weather icon" />
  </div>
  <div class="text-md">Wind: ${weather.mph} mph / ${weather.kmh} km/h</div>
  <div class="row">
    <div class="thermo row" style="gap:6px;">
      <svg viewBox="0 0 20 100" width="18" height="95" aria-label="Thermometer">
        <rect x="8" y="10" width="4" height="80" fill="#ddd" />
        <rect x="8" y="${fillY}" width="4" height="${fillH}" fill="#FD9803" />
        <circle cx="10" cy="94" r="6" fill="#FD9803"/>
        <rect x="7" y="10" width="6" height="84" fill="none" stroke="#666" stroke-width="1"/>
      </svg>
      <div class="text-sm">Feels ~${weather.c}°C</div>
    </div>
    <div class="wind">
      <div class="text-sm">Dir</div>
      <svg viewBox="0 0 100 100" width="36" height="36" aria-label="Wind direction" style="transform:rotate(${windDirDeg}deg);">
        <polygon points="50,8 60,35 50,30 40,35" fill="#112656"></polygon>
        <rect x="47" y="30" width="6" height="50" fill="#112656"></rect>
        <circle cx="50" cy="85" r="6" fill="#112656"></circle>
      </svg>
      <div class="text-xs">${windDirDeg}°</div>
    </div>
  </div>
</section>`;

// Tides page
const renderTideList = (label, items) => `
  <section class="tides-day">
    <div class="label">${label}</div>
    <ul class="list-compact">
      ${(items && items.length ? items : ['—']).map(x => `<li>${compactTide(x)}</li>`).join('')}
    </ul>
  </section>`;
const tidesBody = `
${renderTideList('Today • ' + dayLabel(tides2d.todayKey), tides2d.todayItems)}
${renderTideList('Tomorrow • ' + dayLabel(tides2d.tomorrowKey), tides2d.tomorrowItems)}`;

// Moon page
const moonBody = `
<section class="moon row">
  <div class="stack">
    <div class="label text-md">Phase</div>
    <div class="text-md">${astronomy.phaseName}</div>
  </div>
  <img class="icon-32" src="svg/moon/${astronomy.phaseIcon}.svg" alt="Moon phase" />
</section>`;

// Sun page
const sunBody = `
<section class="sun row">
  <div class="stack" style="text-align:center;">
    <img class="icon-28" src="svg/sunset/sunrise.svg" alt="Sunrise" />
    <div class="text-md" style="font-weight:bold;">${sunrise}</div>
  </div>
  <div class="stack" style="text-align:center;">
    <img class="icon-28" src="svg/sunset/sunset.svg" alt="Sunset" />
    <div class="text-md" style="font-weight:bold;">${sunset}</div>
  </div>
</section>`;

// HTML wrapper (external CSS)
const wrap = (title, body, nextPage) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta http-equiv="refresh" content="10; url='${nextPage}'" />
  <link rel="stylesheet" href="css/vvx.css?v=1" />
</head>
<body>
  <div class="vvx-page">
    <header class="page-header" role="banner">
      <div class="brand">
        <img class="logo" src="images/logo.svg" alt="ndyl" />
      </div>
      <div class="heading">
        <div class="title">${title}</div>
        <div class="date">${fmtDate()}</div>
      </div>
    </header>
    <main class="content" role="main">
      ${body}
    </main>
    <footer class="updated" role="contentinfo">Updated: ${nowStr()}</footer>
  </div>
</body>
</html>`;

// Write pages
await fs.writeFile('page1-weather.html', wrap('Weather', weatherBody, 'page2-tides.html'), 'utf8');
await fs.writeFile('page2-tides.html',   wrap('Tide Times', tidesBody, 'page3-moon.html'), 'utf8');
await fs.writeFile('page3-moon.html',    wrap('Moon', moonBody, 'page4-sun.html'), 'utf8');
await fs.writeFile('page4-sun.html',     wrap('Sunrise & Sunset', sunBody, 'page1-weather.html'), 'utf8');

console.log('Built 4 pages at', new Date().toISOString(), '| local hour', hourLocal());
