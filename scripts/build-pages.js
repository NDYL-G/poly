// scripts/build-pages.js
// Build 4 static VVX-friendly HTML pages using external css/vvx.css
// Works with Weather (Open-Meteo), Tides (Stormglass), Astronomy (WeatherAPI)

import fs from "node:fs/promises";
import path from "node:path";

const lat = 50.4;
const lng = -5.0;
const tz  = "Europe/London";
const CACHE_PATH = "data/cache.json";

const FORCE_TIDES = process.env.FORCE_TIDES === "1";
const FORCE_ASTRONOMY = process.env.FORCE_ASTRONOMY === "1";

/* ===== Time helpers (safe for Node) ===== */
const fmtParts = (d = new Date(), opts = {}) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts }).formatToParts(d);
const ymdLocal = (d = new Date()) => {
  const p = fmtParts(d, { year:"numeric", month:"2-digit", day:"2-digit" });
  const get = t => p.find(x => x.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const hourLocal = () => {
  const p = fmtParts(new Date(), { hour:"2-digit", hour12:false });
  return parseInt(p.find(x => x.type==="hour")?.value || "0",10);
};
const withinActive = () => { const h = hourLocal(); return h>=6 && h<=22; };
const fmtDate = d => new Intl.DateTimeFormat("en-GB",{timeZone:tz,day:"2-digit",month:"short",year:"numeric"}).format(d);
const fmtTime = d => new Intl.DateTimeFormat("en-GB",{timeZone:tz,hour:"2-digit",minute:"2-digit"}).format(new Date(d));
const nowStr = () => fmtTime(new Date());

/* ===== Cache ===== */
async function readCache() {
  try { return JSON.parse(await fs.readFile(CACHE_PATH,"utf8")); }
  catch { return {weather:null,tides2d:null,astronomy:null}; }
}
async function writeCache(cache) {
  await fs.mkdir(path.dirname(CACHE_PATH),{recursive:true});
  await fs.writeFile(CACHE_PATH,JSON.stringify(cache,null,2),"utf8");
}

/* ===== Fetchers ===== */
async function fetchWeather() {
  const j = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`).then(r=>r.json());
  const w = j.current_weather||{};
  const c=Math.round(w.temperature??0), f=Math.round(c*9/5+32);
  const kmh=Math.round(w.windspeed??0), mph=Math.round(kmh*0.6214);
  const dir=Math.round(w.winddirection??0);
  const map={0:"clear-day",1:"partly-cloudy",2:"cloudy",3:"rain",45:"fog",51:"rain",61:"rain",71:"snow",95:"thunderstorm"};
  return {c,f,kmh,mph,winddir:dir,icon:map[w.weathercode]||"clear-day",_ts:new Date().toISOString()};
}
async function fetchAstronomy() {
  const key=process.env.WEATHERAPI_KEY; if(!key)return null;
  const j=await fetch(`https://api.weatherapi.com/v1/astronomy.json?key=${key}&q=Cornwall&dt=today`).then(r=>r.json());
  const a=j.astronomy?.astro||{};
  const phase=a.moon_phase||"—", icon=(phase.toLowerCase().replace(/\s+/g,"-"))||"full-moon";
  return {sunrise:a.sunrise||"--:--",sunset:a.sunset||"--:--",phaseName:phase,phaseIcon:icon,_date:ymdLocal()};
}
async function fetchTides2Days() {
  const key=process.env.STORMGLASS_KEY; if(!key)return null;
  const start=new Date(); start.setHours(0,0,0,0);
  const end=new Date(start); end.setDate(end.getDate()+2);
  const url=`https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${start.toISOString()}&end=${end.toISOString()}`;
  const res=await fetch(url,{headers:{Authorization:key}});
  const j=await res.json();
  const list=(j.data||[]).map(t=>({type:t.type,time:t.time,height:+t.height||0,ymd:ymdLocal(new Date(t.time))}));
  const todayKey=ymdLocal(start);
  const tomorrow=new Date(start); tomorrow.setDate(tomorrow.getDate()+1);
  const tomorrowKey=ymdLocal(tomorrow);
  const byDay={today:[],tomorrow:[]};
  for(const e of list){if(e.ymd===todayKey)byDay.today.push(e);else if(e.ymd===tomorrowKey)byDay.tomorrow.push(e);}
  const fmtRow=e=>`${e.type==="high"?"↑ High":"↓ Low"} ${fmtTime(e.time)} — ${e.height.toFixed(1)} m`;
  return {_date:todayKey,todayKey,tomorrowKey,
    todayItems:byDay.today.map(fmtRow),tomorrowItems:byDay.tomorrow.map(fmtRow)};
}

/* ===== Decision logic ===== */
const cache=await readCache();
const today=ymdLocal();
function shouldFetchWeather(){return withinActive()||!cache.weather;}
function shouldFetchAstronomy(){
  if(FORCE_ASTRONOMY)return true;
  if(!cache.astronomy)return true;
  return hourLocal()===6 && cache.astronomy._date!==today;
}
function shouldFetchTides2D(){
  if(FORCE_TIDES)return true;
  if(!cache.tides2d)return true;
  return hourLocal()===2 && cache.tides2d._date!==today;
}

/* ===== Fetch ===== */
if(shouldFetchWeather()) try{cache.weather=await fetchWeather();}catch{}
if(shouldFetchAstronomy()) try{cache.astronomy=await fetchAstronomy();}catch{}
if(shouldFetchTides2D()) try{cache.tides2d=await fetchTides2Days();}catch{}
await writeCache(cache);

/* ===== Fallbacks ===== */
const weather=cache.weather||{c:0,f:32,kmh:0,mph:0,winddir:0,icon:"clear-day"};
const astronomy=cache.astronomy||{sunrise:"--:--",sunset:"--:--",phaseName:"—",phaseIcon:"full-moon"};
const tides2d=cache.tides2d||{todayItems:["—"],tomorrowItems:["—"],todayKey:today,tomorrowKey:today};

/* ===== Page content ===== */
const stripMeridiem=s=>s.replace(/\s*(AM|PM)$/i,"");
const sunrise=stripMeridiem(astronomy.sunrise), sunset=stripMeridiem(astronomy.sunset);
const dayLabel=ymdStr=>{
  const [y,m,d]=ymdStr.split("-").map(Number);
  const date=new Date(Date.UTC(y,m-1,d,12,0,0));
  return new Intl.DateTimeFormat("en-GB",{timeZone:tz,weekday:"short",day:"2-digit",month:"short"}).format(date);
};
const compactTide=s=>s.replace(/\s*tide\s*/i," ").replace("  "," ").replace(" m","m");

/* Weather visuals */
const frac=Math.max(0,Math.min(1,(weather.c+5)/35));
const fillH=Math.round(80*frac), fillY=90-fillH, windDirDeg=Math.round(weather.winddir%360);

/* ===== Page bodies ===== */
const weatherBody=`
<section class="weather">
  <div class="row">
    <div class="text-lg">${weather.c}°C / ${weather.f}°F</div>
    <img class="icon-30" src="svg/weather/${weather.icon}.svg" alt="Weather icon">
  </div>
  <div class="text-md">Wind: ${weather.mph} mph / ${weather.kmh} km/h</div>
  <div class="row">
    <div class="thermo">
      <svg viewBox="0 0 20 100" width="18" height="95" aria-label="Thermometer">
        <rect x="8" y="10" width="4" height="80" fill="#ddd"/>
        <rect x="8" y="${fillY}" width="4" height="${fillH}" fill="#FD9803"/>
        <circle cx="10" cy="94" r="6" fill="#FD9803"/>
        <rect x="7" y="10" width="6" height="84" fill="none" stroke="#666" stroke-width="1"/>
      </svg>
      <div class="text-sm">Feels ≈ ${weather.c}°C</div>
    </div>
    <div class="wind">
      <div class="text-sm">Dir</div>
      <svg viewBox="0 0 100 100" width="36" height="36" style="transform:rotate(${windDirDeg}deg)">
        <polygon points="50,8 60,35 50,30 40,35" fill="#112656"/>
        <rect x="47" y="30" width="6" height="50" fill="#112656"/>
        <circle cx="50" cy="85" r="6" fill="#112656"/>
      </svg>
      <div class="text-xs">${windDirDeg}°</div>
    </div>
  </div>
</section>`;

const renderTideList=(label,items)=>`
<section class="tides-day">
  <div class="label">${label}</div>
  <ul class="list-compact">${(items&&items.length?items:["—"]).map(x=>`<li>${compactTide(x)}</li>`).join("")}</ul>
</section>`;
const tidesBody=`
${renderTideList("Today • "+dayLabel(tides2d.todayKey),tides2d.todayItems)}
${renderTideList("Tomorrow • "+dayLabel(tides2d.tomorrowKey),tides2d.tomorrowItems)}`;

const moonBody=`
<section class="moon row">
  <div class="stack">
    <div class="label text-md">Phase</div>
    <div class="text-md">${astronomy.phaseName}</div>
  </div>
  <img class="icon-32" src="svg/moon/${astronomy.phaseIcon}.svg" alt="Moon phase">
</section>`;

const sunBody=`
<section class="sun row">
  <div class="stack center">
    <img class="icon-28" src="svg/sunset/sunrise.svg" alt="Sunrise">
    <div class="text-md bold">${sunrise}</div>
  </div>
  <div class="stack center">
    <img class="icon-28" src="svg/sunset/sunset.svg" alt="Sunset">
    <div class="text-md bold">${sunset}</div>
  </div>
</section>`;

/* ===== HTML wrapper using TABLE header ===== */
const wrap=(title,body,next)=>`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta http-equiv="refresh" content="10; url='${next}'">
  <link rel="stylesheet" href="css/vvx.css?v=1">
</head>
<body>
  <div class="vvx-page">
    <header class="page-header" role="banner">
      <table class="hdr"><tr>
        <td class="hdr-left"><img class="logo" src="images/logo.svg" alt="ndyl"></td>
        <td class="hdr-right"><div class="title">${title}</div><div class="date">${fmtDate(new Date())}</div></td>
      </tr></table>
    </header>
    <main class="content">${body}</main>
    <footer class="updated">Updated: ${nowStr()}</footer>
  </div>
</body></html>`;

/* ===== Write pages ===== */
await fs.writeFile("page1-weather.html",wrap("Weather",weatherBody,"page2-tides.html"));
await fs.writeFile("page2-tides.html",wrap("Tide Times",tidesBody,"page3-moon.html"));
await fs.writeFile("page3-moon.html",wrap("Moon",moonBody,"page4-sun.html"));
await fs.writeFile("page4-sun.html",wrap("Sunrise & Sunset",sunBody,"page1-weather.html"));
console.log("VVX pages built:",new Date().toISOString(),"| hour",hourLocal());
