// Pronóstico de lluvia para el Home (Open-Meteo: gratis, sin clave, CABA).
// Mira el horario de reparto (10 a 23 hs) de hoy y mañana y avisa cuando viene lluvia que complica:
//   fuerte  → ≥ 10 mm en el horario de reparto o alguna hora con ≥ 4 mm
//   lluvia  → ≥ 2 mm en el horario de reparto
//   puede   → probabilidad ≥ 50 % aunque marque poca agua
// La misma regla está copiada en vps/parte-diario.js (repo obsidian-flexit) para el parte de las 8:30.
import { useEffect, useState } from 'react';

const URL = 'https://api.open-meteo.com/v1/forecast?latitude=-34.61&longitude=-58.38'
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
      // semana: cada día con su resumen en horario de reparto + mínima/máxima
      const semana = (j.daily && j.daily.time ? j.daily.time : dias).map((d, i) => ({
        fecha: d,
        ...resumirDia(porDia[d] || []),
        min: j.daily ? Math.round(j.daily.temperature_2m_min[i]) : null,
        max: j.daily ? Math.round(j.daily.temperature_2m_max[i]) : null,
      }));
      // ¿está lloviendo ahora? (la hora actual del pronóstico, hora Argentina)
      const ahoraAR = new Date().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 13).replace(' ', 'T');
      const iAhora = j.hourly.time.findIndex((t) => t.slice(0, 13) === ahoraAR);
      const mmAhora = iAhora >= 0 ? j.hourly.precipitation[iAhora] || 0 : 0;
      const ahora = mmAhora >= 2 ? 'fuerte' : mmAhora >= 0.3 ? 'lluvia' : null;
      setClima({ hoy: semana[0], manana: semana[1] || null, semana, ahora });
    }).catch(() => {});
    cargar();
    const t = setInterval(cargar, 60 * 60 * 1000);
    return () => { vivo = false; clearInterval(t); };
  }, []);
  return clima;
}

export const textoNivel = (r) => !r ? '' : r.nivel === 'fuerte' ? `Lluvia fuerte${r.franja ? ' ' + r.franja : ''} · ${r.mm} mm`
  : r.nivel === 'lluvia' ? `Lluvia${r.franja ? ' ' + r.franja : ''} · ${r.mm} mm`
  : r.nivel === 'puede' ? `Puede llover (${r.prob}%)` : 'Sin lluvia en horario de reparto';
export const iconoNivel = (r) => !r ? '' : r.nivel === 'fuerte' ? '⛈️' : r.nivel === 'lluvia' ? '🌧️' : r.nivel === 'puede' ? '🌦️' : '☀️';

// Animación de lluvia de fondo (tipo app del clima del iPhone). Va detrás del contenido de la tarjeta:
// zIndex -1 dentro de la tarjeta, que ya crea su propio contexto de apilamiento (backdrop-filter).
// No cambia el alto de nada y se apaga si el usuario pidió reducir movimiento.
const CSS_LLUVIA = `
@keyframes fx-gota { from { top: -30px; } to { top: 105%; } }
.fx-lluvia { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; pointer-events: none; z-index: -1; }
.fx-lluvia i { position: absolute; top: -30px; width: 1.5px; border-radius: 2px; transform: rotate(12deg);
  background: linear-gradient(to bottom, rgba(150,200,255,0), rgba(150,200,255,0.55)); animation: fx-gota linear infinite; }
@media (prefers-reduced-motion: reduce) { .fx-lluvia { display: none; } }`;

export function Lluvia({ intensidad = 'lluvia' }) {
  const n = intensidad === 'fuerte' ? 46 : intensidad === 'lluvia' ? 26 : 12;
  const vel = intensidad === 'fuerte' ? 0.55 : intensidad === 'lluvia' ? 0.8 : 1.15;
  const gotas = [];
  for (let i = 0; i < n; i++) {
    const r = (k) => ((i * 9301 + k * 49297) % 233280) / 233280; // pseudo-azar estable (no cambia en cada render)
    gotas.push(<i key={i} style={{
      left: `${(r(1) * 104 - 2).toFixed(1)}%`,
      height: `${Math.round(12 + r(2) * 16)}px`,
      opacity: (0.35 + r(3) * 0.65) * (intensidad === 'puede' ? 0.6 : 1),
      animationDuration: `${(vel + r(4) * 0.5).toFixed(2)}s`,
      animationDelay: `${(-r(5) * 2).toFixed(2)}s`,
    }} />);
  }
  return (<><style>{CSS_LLUVIA}</style><div className="fx-lluvia" aria-hidden="true">{gotas}</div></>);
}
