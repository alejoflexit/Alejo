// src/slaShared.js — LA fórmula del SLA Meli, definida UNA sola vez.
//
//   SLA Meli = (envíos ML − demorados − dem21) / envíos ML × 100
//
// dem21 = reprogramados por Mercado Libre después de las 21hs: cuentan como
// incumplimiento igual que los demorados (fix auditoría, commit 4fd79c5).
// No confundir con el SLA Flexit ((total − pendientes) / total), que es otra
// métrica y NO usa esta función.
//
// Reglas:
// - Sin envíos ML (0, null, texto no numérico) → devuelve null; la UI ya
//   muestra "—" / "SIN DATOS" ante null. Nunca devuelve NaN ni Infinity.
// - demorados / dem21 ausentes se tratan como 0.
// - NO redondea: el redondeo es de presentación (toFixed en cada superficie).
// - NO recorta a 0–100: si los datos son inconsistentes (ej. más demorados que
//   envíos) el valor sale del rango a propósito, para que el problema se vea
//   en vez de esconderse.
export function slaMeli(enviosMl, demorados, dem21) {
  const ml = Number(enviosMl);
  if (!Number.isFinite(ml) || ml <= 0) return null;
  const dem = Number(demorados) || 0;
  const d21 = Number(dem21) || 0;
  return (ml - dem - d21) / ml * 100;
}
