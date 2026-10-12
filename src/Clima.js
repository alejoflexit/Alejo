// Pronóstico de lluvia para el Home (Open-Meteo: gratis, sin clave, CABA).
// Mira el horario de reparto (10 a 23 hs) de hoy y mañana y avisa cuando viene lluvia que complica:
//   fuerte  → ≥ 10 mm en el horario de reparto o alguna hora con ≥ 4 mm
//   lluvia  → ≥ 2 mm en el horario de reparto
//   puede   → probabilidad ≥ 50 % aunque marque poca agua
// La misma regla está copiada en vps/parte-diario.js (repo obsidian-flexit) para el parte de las 8:30.
import { useEffect, useState } from 'react';

const URL = 'https://api.open-meteo.com/v1/forecast?latitude=-34.61&longitude=-58.38'
  + '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_gusts_10m,is_day'
  + '&hourly=precipitation,precipitation_probability&daily=precipitation_sum,precipitation_probability_max,temperature_2m_min,temperature_2m_max'
  + '&timezone=America%2FArgentina%2FBuenos_Aires&forecast_days=7';
const DESDE = 10, HASTA = 22; // reparto de 10 a 23 hs (la hora 22 cubre 22 a 23)

export function resumirDia(horas) {
  // horas: [{ hora: 0-23, mm, prob }]
  const reparto = horas.filter((h) => h.hora >= DESDE && h.hora <= HASTA);
  const mm = reparto.reduce((a, h) => a + (h.mm || 0), 0);
  const maxHora = reparto.reduce((a, h) => Math.max(a, h.mm || 0), 0);
  const prob = reparto.reduce((a, h) => Math.max(a, h.prob || 0), 0);
  const conLluvia = reparto.filter((h) => (h.mm || 0) >= 0.5);
  const franja = conLluvia.length ? `${conLluvia[0].hora}–${conLluvia[conLluvia.length - 1].hora + 1} hs` : '';
  const nivel = mm >= 10 || maxHora >= 4 ? 'fuerte' : mm >= 2 ? 'lluvia' : prob >= 50 ? 'puede' : 'seco';
  return { nivel, mm: Math.round(mm * 10) / 10, maxHora: Math.round(maxHora * 10) / 10, prob, franja };
}

// Estado actual según el código WMO de Open-Meteo (lo que está pasando AHORA, no la probabilidad).
const ESTADOS = [
  [[0], 'Despejado', 'despejado'], [[1], 'Casi despejado', 'despejado'], [[2], 'Algo nublado', 'nublado'], [[3], 'Nublado', 'nublado'],
  [[45, 48], 'Niebla', 'nublado'], [[51, 53, 55, 56, 57], 'Llovizna', 'llovizna'], [[61], 'Lluvia débil', 'lluvia'],
  [[63, 66], 'Lluvia', 'lluvia'], [[65, 67], 'Lluvia fuerte', 'fuerte'], [[80], 'Chaparrones', 'lluvia'], [[81], 'Chaparrones', 'fuerte'],
  [[82], 'Chaparrones fuertes', 'fuerte'], [[71, 73, 75, 77, 85, 86], 'Nieve', 'llovizna'], [[95], 'Tormenta', 'tormenta'], [[96, 99], 'Tormenta con granizo', 'tormenta'],
];
export function estadoDe(code) {
  const e = ESTADOS.find(([cs]) => cs.includes(Number(code)));
  return e ? { estado: e[1], cond: e[2] } : { estado: '—', cond: 'nublado' };
}
const LLUEVE = ['llovizna', 'lluvia', 'fuerte', 'tormenta'];

export function useClima() {
  const [clima, setClima] = useState(null);
  useEffect(() => {
    let vivo = true;
    const cargar = () => fetch(URL).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!vivo || !j || !j.hourly) return;
      const porDia = {};
      j.hourly.time.forEach((t, i) => {
        const dia = t.slice(0, 10);
        (porDia[dia] = porDia[dia] || []).push({ hora: Number(t.slice(11, 13)), mm: j.hourly.precipitation[i], prob: j.hourly.precipitation_probability[i] });
      });
      const dias = Object.keys(porDia).sort();
      const ahoraAR = new Date().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
      const hoyISO = ahoraAR.slice(0, 10), horaAct = Number(ahoraAR.slice(11, 13));
      // semana: cada día con su resumen en horario de reparto + mínima/máxima.
      // HOY se resume solo con las horas que quedan: la lluvia de las 10 no sirve a las 15.
      const semana = (j.daily && j.daily.time ? j.daily.time : dias).map((d, i) => ({
        fecha: d,
        ...resumirDia((porDia[d] || []).filter((h) => d !== hoyISO || h.hora >= horaAct)),
        min: j.daily ? Math.round(j.daily.temperature_2m_min[i]) : null,
        max: j.daily ? Math.round(j.daily.temperature_2m_max[i]) : null,
      }));
      // Lo que pasa ahora (bloque "current" de Open-Meteo, cada 15 min).
      const c = j.current || {};
      const est = estadoDe(c.weather_code);
      const actual = {
        temp: c.temperature_2m != null ? Math.round(c.temperature_2m) : null,
        sens: c.apparent_temperature != null ? Math.round(c.apparent_temperature) : null,
        rafagas: c.wind_gusts_10m != null ? Math.round(c.wind_gusts_10m) : 0,
        dia: c.is_day !== 0,
        ...est,
        cond: est.cond === 'despejado' && c.is_day === 0 ? 'noche' : est.cond,
      };
      const ahora = LLUEVE.includes(actual.cond) ? actual.cond : null;
      // Hora por hora del reparto de hoy (10 a 22) para la tira de la tarjeta.
      const horasHoy = (porDia[hoyISO] || []).filter((h) => h.hora >= DESDE && h.hora <= HASTA)
        .map((h) => ({ ...h, pasada: h.hora < horaAct, actual: h.hora === horaAct }));
      // ¿Cuándo? Si llueve: a qué hora para. Si no: cuándo empieza (dentro del reparto).
      const futuras = (porDia[hoyISO] || []).filter((h) => h.hora > horaAct && h.hora <= 23);
      let cuando = '';
      if (ahora) {
        const para = futuras.find((h) => (h.mm || 0) < 0.1 && (h.prob || 0) < 40);
        cuando = para ? `para ~${para.hora} hs` : 'sigue a la noche';
      } else {
        const viene = futuras.find((h) => h.hora <= HASTA && ((h.mm || 0) >= 0.2 || (h.prob || 0) >= 50));
        cuando = viene ? `lluvia desde las ${viene.hora} (${viene.prob}%)` : (horaAct <= HASTA ? 'sin lluvia hasta las 23' : '');
      }
      setClima({ hoy: semana[0], manana: semana[1] || null, semana, ahora, actual, horasHoy, cuando });
    }).catch(() => {});
    cargar();
    const t = setInterval(cargar, 15 * 60 * 1000); // el "ahora" cambia cada 15 min
    return () => { vivo = false; clearInterval(t); };
  }, []);
  return clima;
}

export const textoNivel = (r) => !r ? '' : r.nivel === 'fuerte' ? `Lluvia fuerte${r.franja ? ' ' + r.franja : ''} · ${r.mm} mm`
  : r.nivel === 'lluvia' ? `Lluvia${r.franja ? ' ' + r.franja : ''} · ${r.mm} mm`
  : r.nivel === 'puede' ? `Puede llover (${r.prob}%)` : 'Sin lluvia en horario de reparto';
export const iconoNivel = (r) => !r ? '' : r.nivel === 'fuerte' ? '⛈️' : r.nivel === 'lluvia' ? '🌧️' : r.nivel === 'puede' ? '🌦️' : '☀️';

// Animación de fondo según el cielo de AHORA (tipo app del clima del iPhone). Va detrás del
// contenido de la tarjeta: zIndex -1 dentro de la tarjeta, que ya crea su propio contexto de
// apilamiento (backdrop-filter). No cambia el alto de nada y se apaga con "reducir movimiento".
//   llovizna → gotas finas, cortas y lentas · lluvia → dos planos (lejos/cerca) + salpicaduras
//   fuerte → más densa y rápida · tormenta → lluvia fuerte + relámpagos
//   nublado → nubes que pasan lento · despejado → resplandor cálido · noche → estrellas
// La inclinación de las gotas sigue a las ráfagas de viento.
const CSS_CIELO = `
@keyframes fx-cae { from { top: -30px; transform: translateX(0) rotate(var(--fx-a)); } to { top: 108%; transform: translateX(var(--fx-dx)) rotate(var(--fx-a)); } }
@keyframes fx-salpica { 0%, 70% { transform: scale(0.2); opacity: 0; } 78% { opacity: 0.7; } 100% { transform: scale(1); opacity: 0; } }
@keyframes fx-rayo { 0%, 88%, 100% { opacity: 0; } 89% { opacity: 0.28; } 90% { opacity: 0.04; } 92% { opacity: 0.18; } 95% { opacity: 0; } }
@keyframes fx-nube { from { transform: translateX(-60%); } to { transform: translateX(160%); } }
@keyframes fx-sol { 0%, 100% { opacity: 0.55; transform: scale(1); } 50% { opacity: 0.85; transform: scale(1.08); } }
@keyframes fx-titila { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.8; } }
.fx-cielo { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; pointer-events: none; z-index: -1; }
.fx-cielo .g { position: absolute; top: -30px; border-radius: 2px; background: linear-gradient(to bottom, rgba(160,205,255,0), rgba(160,205,255,0.75)); animation: fx-cae linear infinite; }
.fx-cielo .s { position: absolute; bottom: 3px; width: 10px; height: 3px; border-radius: 50%; border: 1px solid rgba(160,205,255,0.55); animation: fx-salpica ease-out infinite; }
.fx-cielo .r { position: absolute; inset: 0; background: rgba(220,230,255,1); animation: fx-rayo 7s infinite; }
.fx-cielo .n { position: absolute; top: 10%; width: 70%; height: 70%; border-radius: 50%; background: radial-gradient(closest-side, rgba(200,210,235,0.10), rgba(200,210,235,0)); animation: fx-nube linear infinite; }
.fx-cielo .sol { position: absolute; top: -40%; right: -15%; width: 75%; height: 140%; border-radius: 50%; background: radial-gradient(closest-side, rgba(245,192,68,0.20), rgba(245,192,68,0)); animation: fx-sol 9s ease-in-out infinite; }
.fx-cielo .e { position: absolute; width: 2px; height: 2px; border-radius: 50%; background: #fff; animation: fx-titila ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .fx-cielo { display: none; } }`;

const azar = (i, k) => ((i * 9301 + k * 49297) % 233280) / 233280; // pseudo-azar estable (no cambia en cada render)

export function CieloFX({ cond = 'lluvia', rafagas = 0 }) {
  const el = [];
  const llueve = LLUEVE.includes(cond);
  if (llueve) {
    const cfg = {
      llovizna: { n: 30, h: [6, 10], w: 1, vel: [1.5, 2.2], op: [0.25, 0.55] },
      lluvia: { n: 34, h: [12, 22], w: 1.5, vel: [0.75, 1.15], op: [0.35, 0.8] },
      fuerte: { n: 56, h: [16, 28], w: 1.6, vel: [0.45, 0.7], op: [0.4, 0.9] },
      tormenta: { n: 60, h: [16, 28], w: 1.6, vel: [0.42, 0.65], op: [0.4, 0.9] },
    }[cond];
    for (let i = 0; i < cfg.n; i++) {
      const lejos = i % 3 === 0; // un tercio en un plano lejano: más finas, tenues y lentas
      const f = lejos ? 0.6 : 1;
      el.push(<i key={'g' + i} className="g" style={{
        left: `${(azar(i, 1) * 112 - 8).toFixed(1)}%`,
        width: `${lejos ? 1 : cfg.w}px`,
        height: `${Math.round((cfg.h[0] + azar(i, 2) * (cfg.h[1] - cfg.h[0])) * f)}px`,
        opacity: ((cfg.op[0] + azar(i, 3) * (cfg.op[1] - cfg.op[0])) * (lejos ? 0.55 : 1)).toFixed(2),
        animationDuration: `${((cfg.vel[0] + azar(i, 4) * (cfg.vel[1] - cfg.vel[0])) / f).toFixed(2)}s`,
        animationDelay: `${(-azar(i, 5) * 2.4).toFixed(2)}s`,
      }} />);
    }
    if (cond !== 'llovizna') {
      for (let i = 0; i < (cond === 'lluvia' ? 6 : 10); i++) {
        el.push(<i key={'s' + i} className="s" style={{
          left: `${(4 + azar(i, 7) * 90).toFixed(1)}%`,
          animationDuration: `${(0.9 + azar(i, 8) * 0.8).toFixed(2)}s`,
          animationDelay: `${(-azar(i, 9) * 2).toFixed(2)}s`,
        }} />);
      }
    }
    if (cond === 'tormenta') el.push(<i key="r" className="r" />);
  } else if (cond === 'nublado') {
    for (let i = 0; i < 3; i++) el.push(<i key={'n' + i} className="n" style={{ animationDuration: `${38 + i * 14}s`, animationDelay: `${-i * 17}s`, top: `${-10 + i * 25}%` }} />);
  } else if (cond === 'despejado') {
    el.push(<i key="sol" className="sol" />);
  } else if (cond === 'noche') {
    for (let i = 0; i < 14; i++) el.push(<i key={'e' + i} className="e" style={{
      left: `${(azar(i, 1) * 96 + 2).toFixed(1)}%`, top: `${(azar(i, 2) * 80 + 4).toFixed(1)}%`,
      animationDuration: `${(2.5 + azar(i, 3) * 3).toFixed(1)}s`, animationDelay: `${(-azar(i, 4) * 4).toFixed(1)}s`,
    }} />);
  }
  // Viento: 6° sin viento, hasta 26° con ráfagas fuertes; el desplazamiento acompaña el ángulo.
  const a = Math.max(6, Math.min(26, 6 + (rafagas - 10) * 0.45));
  const vars = { '--fx-a': `${a}deg`, '--fx-dx': `${-Math.round(a * 4.5)}px` };
  return (<><style>{CSS_CIELO}</style><div className="fx-cielo" style={vars} aria-hidden="true">{el}</div></>);
}

// Compatibilidad con el aviso de lluvia (recibe el nivel del pronóstico o el "ahora").
export function Lluvia({ intensidad = 'lluvia', rafagas = 0 }) {
  const cond = intensidad === 'puede' ? 'llovizna' : intensidad;
  return <CieloFX cond={cond} rafagas={rafagas} />;
}
