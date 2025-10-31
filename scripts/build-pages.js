// scripts/build-pages.js
// Builds 4 VVX-friendly pages with no client-side JS.
// - Weather (inline thermometer + wind arrow)
// - Tide Times (inline mini bar chart)
// - Moon (phase + optional icon)
// - Sunrise & Sunset
//
// Needs Node.js 20+ (GitHub Actions step sets this).
// Optional secrets: WEATHERAPI_KEY (WeatherAPI), STORMGLASS_KEY (Stormglass)

import fs from 'node:fs/promises';

// ==== CONFIG ====
const lat = 50.4;           // your coordinates
const lng = -5.0;
const tz  = 'Europe/London';

// ==== HELPERS ====
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const fmtDate = (d = new Date()) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz });

const fmtTime = (d) =>
  new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });

const nowStr = () =>
  new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });

// ==== DATA FETCH ====
async function getWeather() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`;
  const j = await fetch(url).then(r => r.json());
  const w = j.current_weather || {};
  const c   = Math.round(w.temperature ?? 0);
  const f   = Math.round(c * 9 / 5 + 32);
  const kmh = Math.round(w.windspeed ?? 0);
  const mph = Math.round(kmh * 0.621371);
  const dir = Math.round(w.winddirection ?? 0);
  const codeMap = {
    0: 'clear-day', 1: 'partly-cloudy', 2: 'cloudy', 3: 'rain',
    45: 'fog', 51: 'rain', 61: 'rain', 71: 'snow', 95: 'thunderstorm'
  };
  return { c, f, kmh, mph, winddir: dir, icon: codeMap[w.weathercode] || 'clear-day' };
}

async function getAstronomy() {
  const key = process.env.WEATHERAPI_KEY;
  if (!key) return { sunrise: '--:--', sunset: '--:--', phaseName: '—', phaseIcon: 'full-moon' };
  const j = await fetch(`https://api.weatherapi.com/v1/astronomy.json?key=${key}&q=Cornwall&dt=today`).then(r => r.json());
  const a = j.astronomy?.astro || {};
  const phaseName = a.moon_phase || '—';
  const phaseIcon = (phaseName.toLowerCase().replace(/\s+/g, '-')) || 'full-moon';
  return { sunrise: a.sunrise || '--:--', sunset: a.sunset || '--:--', phaseName, phaseIcon };
}

async function getTides() {
  const key = process.env.STORMGLASS_KEY;
  if (!key) return { items: ['—', '—'], itemsRaw: [] };
  const start = new Date().toISOString();
  const j = await fetch(
    `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${start}`,
    { headers: { Authorization: key } }
  ).then(r => r.json());
  const list = (j.data || []).map(t => ({
    type: t.type, time: t.time, height: Number(t.height || 0)
  }));
  const items = list.slice(0, 2).map(t =>
    `${t.type === 'high' ? '↑ High' : '↓ Low'} tide at ${fmtTime(t.time)} — ${t.height.toFixed(1)} m`
  );
  while (items.length < 2) items.push('—');
  return { items, itemsRaw: list };
}

// ==== PAGE WRAPPER ====
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

// ==== BUILD PAGES ====
const [weather, astro, tides] = await Promise.all([getWeather(), getAstronomy(), getTides()]);

// Weather page body: inline thermometer + rotated wind arrow
// Thermometer: map -5..30°C to 0..80px fill
const tMin = -5, tMax = 30;
const frac = clamp((weather.c - tMin) / (tMax - tMin), 0, 1);
const fillH = Math.round(80 * frac);
const fillY = 90 - fillH;
const windDirDeg = Math.round((weather.winddir ?? 0) % 360);

const weatherBody = `
<div style="padding:10px 12px;">
  <div style="display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:bold;">${weather.c}°C / ${weather.f}°F</div>
    <!-- Optional external icon: remove img if you don't have svg/weather icons -->
    <img src="svg/weather/${weather.icon}.svg" alt="icon" style="width:40px;height:40px">
  </div>

  <div style="margin-top:6px;font-size:13px;">Wind: ${weather.mph} mph / ${weather.kmh} km/h</div>

  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">
    <!-- Inline thermometer -->
    <div style="display:flex;align-items:center;gap:8px;">
      <svg viewBox="0 0 20 100" width="22" height="110" aria-label="Thermometer">
        <rect x="8" y="10" width="4" height="80" fill="#ddd" />
        <rect x="8" y="${fillY}" width="4" height="${fillH}" fill="#FD9803" />
        <circle cx="10" cy="94" r="6" fill="#FD9803"/>
        <rect x="7" y="10" width="6" height="84" fill="none" stroke="#666" stroke-width="1"/>
      </svg>
      <div style="font-size:12px;">Feels ~${weather.c}°C</div>
    </div>

    <!-- Inline wind arrow rotated by windDirDeg -->
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

// Tide page body: two bars from the first two extremes
const heights = (tides.itemsRaw || []).map(x => x.height).filter(n => typeof n === 'number');
const maxH = heights.length ? Math.max(...heights) : 1;
const scale = 90 / maxH;
const tideBars = (tides.itemsRaw || []).slice(0, 2).map((x, i) => {
  const h = Math.max(1, Math.round((x.height || 0) * scale));
  const y = 95 - h;
  const xPos = 40 + i * 70;
  return `
    <rect x="${xPos}" y="${y}" width="40" height="${h}" rx="4" fill="${x.type === 'high' ? '#FD9803' : '#112656'}"></rect>
    <text x="${xPos + 20}" y="98" font-size="8" text-anchor="middle" fill="#333">${(x.height || 0).toFixed(1)}m</text>
    <text x="${xPos + 20}" y="12" font-size="8" text-anchor="middle" fill="#333">${x.type === 'high' ? 'High' : 'Low'}</text>
  `;
}).join('');

const tidesBody = `
<div style="padding:10px 12px;font-size:14px;line-height:1.4;">
  <div>${tides.items[0] || '—'}</div>
  <div>${tides.items[1] || '—'}</div>
</div>
<div style="display:flex;justify-content:center;">
  <svg viewBox="0 0 200 100" width="200" height="100" aria-label="Tide chart">
    <rect x="0" y="0" width="200" height="100" fill="#f9f9f9" stroke="#e0e0e0"></rect>
    ${tideBars || ''}
  </svg>
</div>
`;

// Moon page body
const moonBody = `
<div style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;">
  <div>
    <div style="font-weight:bold;">Phase</div>
    <div style="font-size:14px;">${astro.phaseName}</div>
  </div>
  <!-- Optional external moon icon. Remove img if not present -->
  <img src="svg/moon/${astro.phaseIcon}.svg" alt="moon" style="width:40px;height:40px">
</div>
`;

// Sun page body
const sunBody = `
<div style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;">
  <div style="text-align:center">
    <img src="svg/sunset/sunrise.svg" alt="sunrise" style="width:36px;height:36px"><br>
    <span style="font-weight:bold;">${astro.sunrise}</span>
  </div>
  <div style="text-align:center">
    <img src="svg/sunset/sunset.svg" alt="sunset" style="width:36px;height:36px"><br>
    <span style="font-weight:bold;">${astro.sunset}</span>
  </div>
</div>
`;

// ==== WRITE FILES ====
const p1 = wrap('Weather',           weatherBody, 'page2-tides.html');
const p2 = wrap('Tide Times',        tidesBody,   'page3-moon.html');
const p3 = wrap('Moon',              moonBody,    'page4-sun.html');
const p4 = wrap('Sunrise & Sunset',  sunBody,     'page1-weather.html');

await fs.writeFile('page1-weather.html', p1, 'utf8');
await fs.writeFile('page2-tides.html',  p2, 'utf8');
await fs.writeFile('page3-moon.html',   p3, 'utf8');
await fs.writeFile('page4-sun.html',    p4, 'utf8');

console.log('Built 4 pages at', new Date().toISOString());
