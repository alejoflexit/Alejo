import { slaMeli } from "./slaShared";

export const SEGUIMIENTO_CFG = { slaObjetivo: 98, slaCritico: 95, minMl: 30 };
const norm = s => String(s || "").trim().replace(/\s+/g, " ");
const esOperativo = n => n.startsWith("⚠️") || /repro ?gramar|devuelto dep[oó]sito|qued[oó] en dep[oó]sito/i.test(n);

export function agregarSemana(semana) {
  const map = {};
  for (const dia of (semana && semana.dias) || []) for (const f of dia.datos || []) {
    const cadete = norm(f.cadete);
    if (!cadete || esOperativo(cadete)) continue;
    const c = map[cadete] || (map[cadete] = { cadete, enviosMl:0, demorados:0, dem21:0, demoradosDetalle:[], dem21Detalle:[] });
    c.enviosMl += Number(f.envios_ml) || 0;
    c.demorados += Number(f.demorados) || 0;
    c.dem21 += Number(f.dem21) || 0;
    c.demoradosDetalle.push(...(f.demoradosDetalle || []));
    c.dem21Detalle.push(...(f.dem21Detalle || []));
  }
  return Object.values(map).map(c => ({ ...c, sla:slaMeli(c.enviosMl, c.demorados, c.dem21) }));
}

export function construirSeguimiento(semanas, semanaLabel) {
  const i = semanas.findIndex(s => s.label === semanaLabel);
  if (i < 0) return { actual:null, anterior:null, filas:[] };
  const actual = semanas[i], anterior = i > 0 ? semanas[i - 1] : null;
  const prev = new Map(agregarSemana(anterior).map(c => [c.cadete, c]));
  const filas = agregarSemana(actual).filter(c => c.sla !== null && c.sla < 98).map(c => {
    const p = prev.get(c.cadete), slaAnterior = p && p.sla !== null ? p.sla : null;
    return { ...c, slaAnterior, delta:slaAnterior === null ? null : c.sla - slaAnterior, muestraChica:c.enviosMl < 30, reincidente:slaAnterior !== null && slaAnterior < 98, critico:c.sla < 95 };
  }).sort((a,b) => Number(a.muestraChica)-Number(b.muestraChica) || Number(b.critico)-Number(a.critico) || Number(b.reincidente)-Number(a.reincidente) || (a.delta ?? 999)-(b.delta ?? 999) || a.sla-b.sla);
  return { actual, anterior, filas };
}

const pct = n => Number(n).toLocaleString("es-AR", { minimumFractionDigits:2, maximumFractionDigits:2 });
export function mensajeCadete(f) {
  const nombre = f.cadete.split(" ")[0];
  let comp = "";
  if (f.slaAnterior !== null) comp = f.delta >= .1 ? ` Mejoraste respecto de la semana anterior, cuando habías obtenido ${pct(f.slaAnterior)}%.` : f.delta <= -.1 ? ` La semana anterior habías obtenido ${pct(f.slaAnterior)}%.` : ` Te mantuviste prácticamente igual que la semana anterior (${pct(f.slaAnterior)}%).`;
  const muestra = f.muestraChica ? " Como esta semana tuviste menos de 30 envíos Flex, lo tomamos como seguimiento y no como una conclusión definitiva." : "";
  const accion = f.delta !== null && f.delta >= .1 ? "Bien por la mejora; todavía necesitamos llegar al 98%, así que sigamos atentos esta semana." : "Necesitamos mantenernos arriba del 98%. Por favor, prestá especial atención a cerrar la ruta y registrar los “Nadie” o reprogramaciones antes de las 21 hs.";
  return `Hola ${nombre}, ¿cómo estás? Esta semana tu SLA Meli fue de ${pct(f.sla)}%, sobre ${f.enviosMl} envíos Flex. Tuviste ${f.demorados} envío${f.demorados===1?"":"s"} demorado${f.demorados===1?"":"s"} y ${f.dem21} reprogramado${f.dem21===1?"":"s"} después de las 21 hs.${comp}${muestra}\n\n${accion} Si considerás que algún caso no corresponde, avisame y lo revisamos. La semana próxima volvemos a medirlo. Gracias.`;
}
