// scripts/build-pages.js
import fs from 'node:fs/promises';

const lat = 50.4, lng = -5.0; // adjust if needed
const tz = 'Europe/London';

const fmtDate = (d=new Date()) =>
  d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric', timeZone: tz });

const fmtTime = (d) =>
  new Date(d).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', timeZone: tz });

const nowStr = () =>
  new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', timeZone: tz });

async function getWeather(){
  const j = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`)
    .then(r=>r.json());
  const w = j.current_weather || {};
  const c = Math.round(w.temperature ?? 0);
  const f = Math.round(c*9/5+32);
  const kmh = Math.round(w.windspeed ?? 0);
  const mph = Math.round(kmh*0.621371);
  const map = {0:'clear-day',1:'partly-cloudy',2:'cloudy',3:'rain',45:'fog',51:'rain',61:'rain',71:'snow',95:'thunderstorm'};
  return { c, f, kmh, mph, icon: map[w.weathercode] || 'clear-day' };
}

async function getAstronomy(){
  const key = process.env.WEATHERAPI_KEY;
  if (!key) return { sunrise:'--:--', sunset:'--:--', phaseName:'—', phaseIcon:'full-moon' };
  const j = await fetch(`https://api.weatherapi.com/v1/astronomy.json?key=${key}&q=Cornwall&dt=today`).then(r=>r.json());
  const a = j.astronomy?.astro || {};
  const phaseName = a.moon_phase || '—';
  const phaseIcon = (phaseName.toLowerCase().replace(/\s+/g,'-')) || 'full-moon';
  return { sunrise: a.sunrise || '--:--', sunset: a.sunset || '--:--', phaseName, phaseIcon };
}

async function getTides(){
  const key = process.env.STORMGLASS_KEY;
  if (!key) return { items: ['—', '—'] };
  const start = new Date().toISOString();
  const j = await fetch(
    `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${start}`,
    { headers: { Authorization: key } }
  ).then(r=>r.json());
  const list = j.data || [];
  const items = list.slice(0,2).map(t => {
    const arrow = t.type === 'high' ? '↑ High' : '↓ Low';
    return `${arrow} tide at ${fmtTime(t.time)} — ${Number(t.height).toFixed(1)} m`;
  });
  while (items.length < 2) items.push('—');
  return { items };
}

const [weather, astro, tides] = await Promise.all([getWeather(), getAstronomy(), getTides()]);
const todayStr = fmtDate();
const updated = nowStr();

function page1(){ return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><title>Weather</title>
<meta http-equiv="refresh" content="10; url='page2-tides.html'">
</head><body style="margin:0;background:#f4f4f4;color:#112656;font-family:Arial,sans-serif;">
<div style="width:320px;height:240px;overflow:hidden;background:#fff;">
<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-bottom:3px solid #FD9803;">
<img src="images/logo.svg" alt="ndyl" style="height:24px">
<div style="text-align:right;"><div style="font-weight:bold;color:#FD9803;">Weather</div><div style="font-size:12px">${todayStr}</div></div>
</div>
<div style="padding:10px 12px;">
<div style="display:flex;align-items:center;justify-content:space-between;">
<div style="font-size:20px;font-weight:bold;">${weather.c}°C / ${weather.f}°F</div>
<img src="svg/weather/${weather.icon}.svg" alt="icon" style="width:40px;height:40px">
</div>
<div style="margin-top:6px;font-size:13px;">Wind: ${weather.mph} mph / ${weather.kmh} km/h</div>
</div>
<div style="position:absolute;bottom:6px;width:100%;text-align:center;font-size:10px;color:#666;">Updated: ${updated}</div>
</div></body></html>`; }

function page2(){ return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><title>Tide Times</title>
<meta http-equiv="refresh" content="10; url='page3-moon.html'">
</head><body style="margin:0;background:#f4f4f4;color:#112656;font-family:Arial,sans-serif;">
<div style="width:320px;height:240px;overflow:hidden;background:#fff;">
<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-bottom:3px solid #FD9803;">
<img src="images/logo.svg" alt="ndyl" style="height:24px">
<div style="text-align:right;"><div style="font-weight:bold;color:#FD9803;">Tide Times</div><div style="font-size:12px">${todayStr}</div></div>
</div>
<div style="padding:10px 12px;font-size:14px;line-height:1.4;">
<div>${tides.items[0]}</div>
<div>${tides.items[1]}</div>
</div>
<div style="position:absolute;bottom:6px;width:100%;text-align:center;font-size:10px;color:#666;">Updated: ${updated}</div>
</div></body></html>`; }

function page3(){ return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><title>Moon</title>
<meta http-equiv="refresh" content="10; url='page4-sun.html'">
</head><body style="margin:0;background:#f4f4f4;color:#112656;font-family:Arial,sans-serif;">
<div style="width:320px;height:240px;overflow:hidden;background:#fff;">
<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-bottom:3px solid #FD9803;">
<img src="images/logo.svg" alt="ndyl" style="height:24px">
<div style="text-align:right;"><div style="font-weight:bold;color:#FD9803;">Moon</div><div style="font-size:12px">${todayStr}</div></div>
</div>
<div style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;">
<div><div style="font-weight:bold;">Phase</div><div style="font-size:14px;">${astro.phaseName}</div></div>
<img src="svg/moon/${astro.phaseIcon}.svg" alt="moon" style="width:40px;height:40px">
</div>
<div style="position:absolute;bottom:6px;width:100%;text-align:center;font-size:10px;color:#666;">Updated: ${updated}</div>
</div></body></html>`; }

function page4(){ return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><title>Sunrise & Sunset</title>
<meta http-equiv="refresh" content="10; url='page1-weather.html'">
</head><body style="margin:0;background:#f4f4f4;color:#112656;font-family:Arial,sans-serif;">
<div style="width:320px;height:240px;overflow:hidden;background:#fff;">
<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-bottom:3px solid #FD9803;">
<img src="images/logo.svg" alt="ndyl" style="height:24px">
<div style="text-align:right;"><div style="font-weight:bold;color:#FD9803;">Sunrise & Sunset</div><div style="font-size:12px">${todayStr}</div></div>
</div>
<div style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;">
<div style="text-align:center"><img src="svg/sunset/sunrise.svg" alt="sunrise" style="width:36px;height:36px"><br><span style="font-weight:bold;">${astro.sunrise}</span></div>
<div style="text-align:center"><img src="svg/sunset/sunset.svg" alt="sunset" style="width:36px;height:36px"><br><span style="font-weight:bold;">${astro.sunset}</span></div>
</div>
<div style="position:absolute;bottom:6px;width:100%;text-align:center;font-size:10px;color:#666;">Updated: ${updated}</div>
</div></body></html>`; }

await fs.writeFile('page1-weather.html', page1(), 'utf8');
await fs.writeFile('page2-tides.html', page2(), 'utf8');
await fs.writeFile('page3-moon.html', page3(), 'utf8');
await fs.writeFile('page4-sun.html', page4(), 'utf8');

console.log('Built 4 pages at', new Date().toISOString());
