// scripts/build-pages.js
// Build 4 static pages for Poly VVX (no client JS) with rate-limited fetching + caching.
// - Weather: hourly (06–22 local) or on first run; source: Open-Meteo (no key)
// - Tides: today+tomorrow (48h) once/day at 02:00 local; source: Stormglass (needs STORMGLASS_KEY)
// - Astronomy: once/day at 06:00 local; source: WeatherAPI (needs WEATHERAPI_KEY)
// Supports manual forcing via env: FORCE_TIDES=1, FORCE_ASTRONOMY=1

import fs from 'node:fs/promises';
import path from 'node:path';

// ===== CONFIG =====
const lat = 50.4;
const lng = -5.0;
const tz  = 'Europe/London';
const CACHE_PATH = 'data/cache.json';

// ===== FORCE SWITCHES (optional) =====
const FORCE_TIDES = process.env.FORCE_TIDES === '1';
const FORCE_ASTRONOMY = process.env.FORCE_ASTRONOMY === '1';

// ===== TIME HELPERS =====
const now = () => new Date();

const hourLocal = () =>
  parseInt(now().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }), 10);

const dateParts = (d = new Date()) => {
  const z = d.toLocaleString('en-GB', { timeZone: tz });
  const nd = new Date(z);
  const yyyy = nd.getFullYear();
  const mm = String(nd.getMonth() + 1).padStart(2, '0');
  const dd = String(nd.getDate()).padStart(2, '0');
  return { yyyy, mm, dd };
};

const ymdLocal = (d = new Date()) => {
  const { yyyy, mm, dd } = dateParts(d);
  return `${yyyy}-${mm}-${dd}`;
};

const withinActive = () => {
  const h = hourLocal();
  return h >= 6 && h <= 22;
};

const fmtDate = (d = now()) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz });

const fmtTime = (d) =>
  new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });

const nowStr = () =>
  now().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });

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
  const codeMap = {
    0: 'clear-day', 1: 'partly-cloudy', 2: 'cloudy', 3: 'rain',
    45: 'fog', 51: 'rain', 61: 'rain', 71: 'snow', 95: 'thunderstorm'
  };
  return { c, f, kmh, mph, winddir: dir, icon: codeMap[w.weathercode] || 'clear-day', _ts: new Date().toISOString() };
}

async function fetchAstronomy() {
  const key = process.env.WEATHERAPI_KEY;
  if (!key) return null; // will render placeholders if absent
  const j = await fetch(`https://api.weatherapi.com/v1/astronomy.json?key=${key}&q=Cornwall&dt=today`).then(r => r.json());
  const a = j.astronomy?.astro || {};
  const phaseName = a.moon_phase || '—';
  const phaseIcon = (phaseName.toLowerCase().replace(/\s+/g, '-')) || 'full-moon';
  return {
    sunrise: a.sunrise || '--:--',
    sunset: a.sunset || '--:--',
    phaseName,
    phaseIcon,
    _date: ymdLocal()
  };
}

// 48h tide extremes for today + tomorrow
async function fetchTides2Days() {
  const key = process.env.STORMGLASS_KEY;
  if (!key) return null;

  const today = new Date(now().toLocaleString('en-GB', { timeZone: tz }));
  today.setHours(0, 0, 0, 0);
  const startISO = today.toISOString();

  const end = new Date(today);
  end.setDate(end.getDate() + 2);
  end.setMilliseconds(end.getMilliseconds() - 1);
  const endISO = end.toISOString();

  const url = `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${startISO}&end=${endISO}`;
  const j = await fetch(url, { headers: { Authorization: key } }).then(r => r.json());

  const list = (j.data || []).map(t => ({
    type: t.type,
    time: t.time,
    height: Number(t.height || 0),
    ymd: ymdLocal(new Date(t.time))
  }));

  const todayKey = ymdLocal(today);
  const tomorrowRef = new Date(today); tomorrowRef.setDate(tomorrowRef.getDate() + 1);
  const tomorrowKey = ymdLocal(tomorrowRef);

  const byDay = { todayKey, tomorrowKey, today: [], tomorrow: [] };
  for (const e of list) {
    if (e.ymd === todayKey) byDay.today.push(e);
    else if (e.ymd === tomorrowKey) byDay.tomorrow.push(e);
  }
  byDay.today.sort((a, b) => new Date(a.time) - new Date(b.time));
  byDay.tomorrow.sort((a, b) => new Date(a.time) - new Date(b.time));
  byDay.today = byDay.today.slice(0, 4);
  byDay.tomorrow = byDay.tomorrow.slice(0, 4);

  const fmtRow = (e) => `${e.type === 'high' ? '↑ High' : '↓ Low'} ${fmtTime(e.time)} — ${e.height.toFixed(1)} m`;

  return {
    _date: todayKey,
    todayKey, tomorrowKey,
    todayItems: byDay.today.map(fmtRow),
    tomorrowItems: byDay.tomorrow.map(fmtRow),
    raw: byDay
  };
}

// ===== DECISION LOGIC (with seeding + force) =====
const cache = await readCache();

function shouldFetchWeather() {
  // fetch during active window OR seed if absent
  return withinActive() || !cache.weather;
}

function shouldFetchAstronomy() {
  if (FORCE_ASTRONOMY) return true;
  const today = ymdLocal();
  if (!cache.astronomy) return true;      // seed now
  const h = hourLocal();
  return h === 6 && cache.astronomy._date !== today;
}

function shouldFetchTides2D() {
  if (FORCE_TIDES) return true;
  const today = ymdLocal();
  if (!cache.tides2d) return true;        // seed now
  const h = hourLocal();
  return h === 2 && cache.tides2d._date !== today;
}

// ===== FETCH (guarded) =====
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

// Fallbacks (first run without keys, etc.)
if (!weather)   weather   = { c: 0, f: 32, kmh: 0, mph: 0, winddir: 0, icon: 'clear-day' };
if (!astronomy) astronomy = { sunrise: '--:--', sunset: '--:--', phaseName: '—', phaseIcon: 'full-moon' };
if (!tides2d)   tides2d   = {
  todayItems: ['—'],
  tomorrowItems: ['—'],
  raw: { today: [], tomorrow: [] },
  todayKey: ymdLocal(),
  tomorrowKey: ymdLocal(new Date(now().getTime() + 86400000))
};

// Persist cache
await writeCache(cache);

// ===== RENDER PAGES =====
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Weather visuals
const tMin = -5, tMax = 30;
const frac = clamp((weather.c - tMin) / (tMax - tMin), 0, 1);
const fillH = Math.round(80 * frac);
const fillY = 90 - fillH;
const windDirDeg = Math.round((weather.winddir ?? 0) % 360);

const weatherBody = `
<div style="padding:10px 12px;">
  <div style="display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:bold;">${weather.c}°C / ${weather.f}°F</div>
    <!-- Uses your existing /svg/weather/${weather.icon}.svg -->
    <img src="svg/weather/${weather.icon}.svg" alt="icon" style="width:40px;height:40px">
  </div>
  <div style="margin-top:6px;font-size:13px;">Wind: ${weather.mph} mph / ${weather.kmh} km/h</div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">
    <div style="display:flex;align-items:center;gap:8px;">
      <svg viewBox="0 0 20 100" width="22" height="110" aria-label="Thermometer">
        <rect x="8" y="10" width="4" height="80" fill="#ddd" />
        <rect x="8" y="${fillY}" width="4" height="${fillH}" fill="#FD9803" />
        <circle cx="10" cy="94" r="6" fill="#FD9803"/>
        <rect x="7" y="10" width="6" height="84" fill="none" stroke="#666" stroke-width="1"/>
      </svg>
      <div style="font-size:12px;">Feels ~${weather.c}°C</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:12px;margin-bottom:2px;">Direction</div>
      <svg viewBox="0 0 100 100" width="42" height="42" aria-label="Wind direction" style="transform:rotate(${windDirDeg}deg);">
        <polygon points="50,8 60,35 50,30 40,35" fill="#112656"></polygon>
        <rect x="47" y="30" width="6" height="50" fill="#112656"></rect>
        <circle cx="50" cy="85" r="6" fill="#112656"></circle>
      </svg>
      <div style="font-size:10px;margin-top:2px;">${windDirDeg}°</div>
    </div>
  </div>
</div>
`;

// Tides page (today + tomorrow, up to 4 items each)
const dayLabel = (ymdStr) => {
  const [yyyy, mm, dd] = ymdStr.split('-').map(Number);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: tz });
};

const tidesBody = `
<div style="padding:8px 10px;display:flex;gap:10px;justify-content:space-between;">
  <div style="width:48%;">
    <div style="font-weight:bold;color:#FD9803;margin-bottom:4px;">Today • ${dayLabel(tides2d.todayKey)}</div>
    ${(tides2d.todayItems && tides2d.todayItems.length)
      ? `<ul style="padding-left:14px;margin:0;font-size:13px;line-height:1.35;">${tides2d.todayItems.map(x=>`<li>${x}</li>`).join('')}</ul>`
      : `<div style="font-size:13px;">—</div>`}
  </div>
  <div style="width:48%;">
    <div style="font-weight:bold;color:#FD9803;margin-bottom:4px;">Tomorrow • ${dayLabel(tides2d.tomorrowKey)}</div>
    ${(tides2d.tomorrowItems && tides2d.tomorrowItems.length)
      ? `<ul style="padding-left:14px;margin:0;font-size:13px;line-height:1.35;">${tides2d.tomorrowItems.map(x=>`<li>${x}</li>`).join('')}</ul>`
      : `<div style="font-size:13px;">—</div>`}
  </div>
</div>
`;

// Moon & Sun
const moonBody = `
<div style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;">
  <div>
    <div style="font-weight:bold;">Phase</div>
    <div style="font-size:14px;">${astronomy.phaseName}</div>
  </div>
  <!-- Uses your existing /svg/moon/${astronomy.phaseIcon}.svg -->
  <img src="svg/moon/${astronomy.phaseIcon}.svg" alt="moon" style="width:40px;height:40px">
</div>
`;

const sunBody = `
<div style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;">
  <div style="text-align:center">
    <img src="svg/sunset/sunrise.svg" alt="sunrise" style="width:36px;height:36px"><br>
    <span style="font-weight:bold;">${astronomy.sunrise}</span>
  </div>
  <div style="text-align:center">
    <img src="svg/sunset/sunset.svg" alt="sunset" style="width:36px;height:36px"><br>
    <span style="font-weight:bold;">${astronomy.sunset}</span>
  </div>
</div>
`;

// Wrapper
const wrap = (title, body, nextPage) => `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><title>${title}</title>
<meta http-equiv="refresh" content="10; url='${nextPage}'">
</head><body style="margin:0;background:#f4f4f4;color:#112656;font-family:Arial,sans-serif;">
<div style="width:320px;height:240px;overflow:hidden;background:#fff;position:relative;">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-bottom:3px solid #FD9803;">
    <img src="images/logo.svg" alt="ndyl" style="height:24px">
    <div style="text-align:right;">
      <div style="font-weight:bold;color:#FD9803;">${title}</div>
      <div style="font-size:12px">${fmtDate()}</div>
    </div>
  </div>
  ${body}
  <div style="position:absolute;bottom:6px;left:0;right:0;text-align:center;font-size:10px;color:#666;">Updated: ${nowStr()}</div>
</div>
</body></html>`;

// Write pages
await fs.writeFile('page1-weather.html', wrap('Weather',          weatherBody, 'page2-tides.html'), 'utf8');
await fs.writeFile('page2-tides.html',   wrap('Tide Times',       tidesBody,   'page3-moon.html'), 'utf8');
await fs.writeFile('page3-moon.html',    wrap('Moon',             moonBody,    'page4-sun.html'), 'utf8');
await fs.writeFile('page4-sun.html',     wrap('Sunrise & Sunset', sunBody,     'page1-weather.html'), 'utf8');

console.log('Built 4 pages at', new Date().toISOString(), '| local hour', hourLocal(),
            '| force_tides', FORCE_TIDES, '| force_astro', FORCE_ASTRONOMY);
