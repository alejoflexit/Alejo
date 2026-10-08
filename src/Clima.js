// Pronóstico de lluvia para el Home (Open-Meteo: gratis, sin clave, CABA).
// Mira el horario de reparto (10 a 21 hs) de hoy y mañana y avisa cuando viene lluvia que complica:
//   fuerte  → ≥ 10 mm en el horario de reparto o alguna hora con ≥ 4 mm
//   lluvia  → ≥ 2 mm en el horario de reparto
//   puede   → probabilidad ≥ 50 % aunque marque poca agua
// La misma regla está copiada en vps/parte-diario.js (repo obsidian-flexit) para el parte de las 8:30.
import { useEffect, useState } from 'react';

const URL = 'https://api.open-meteo.com/v1/forecast?latitude=-34.61&longitude=-58.38'
  + '&hourly=precipitation,precipitation_probability&timezone=America%2FArgentina%2FBuenos_Aires&forecast_days=2';
const DESDE = 10, HASTA = 21;

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
      setClima({ hoy: resumirDia(porDia[dias[0]] || []), manana: dias[1] ? resumirDia(porDia[dias[1]]) : null });
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
