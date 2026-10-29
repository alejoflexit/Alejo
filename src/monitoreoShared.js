// monitoreoShared.js — lógica pura de la pantalla Monitoreo (testeada en monitoreoShared.test.js).
// Entrada: la respuesta del bridge GET /reparto (A planta = hoy). Todos los horarios son
// minutos del día AR (0–1439), tal como los devuelve el bridge.

export const INICIO_REPARTO = 10 * 60;   // el reparto va de 10 a 23 hs
export const FIN_REPARTO = 23 * 60;
export const CORTE_21 = 21 * 60;
export const MIN_FRENADO = 60;            // sin entregas hace 60' con pendientes = frenado
export const MIN_LENTO = 25;              // sin ningún movimiento hace 25' = avisar
export const MIN_CAIDA = 45;              // sin ningún movimiento hace 45' = posible caída
export const BALDE = 15;                  // el bridge agrupa la actividad cada 15'

export const hhmm = (min) => (min === null || min === undefined) ? "—"
  : `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function hace(min) {
  if (min === null || min === undefined) return "";
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min}'`;
  const h = Math.floor(min / 60), m = min % 60;
  return `hace ${h} h${m ? ` ${m}'` : ""}`;
}

// Ritmo (entregas por hora) y hora estimada de fin, con lo que lleva entregado.
// Necesita al menos 3 entregas separadas por 20' o más; si no, no inventa.
// Reglas de Métricas aplicadas en vivo (las calcula el bridge /reparto; ver wiki spec-monitoreo-reparto):
//   flexRiesgo   = Flex que serían DEMORADOS si el día cerrara ahora (en camino / en planta / vacío sin
//                  intento válido antes de las 21, historial de hoy o ayer)
//   repro21      = Flex con Nadie/Reprogramado a las 21:00 o después sin intento previo (dem21)
//   partSinVisita = particulares vacío / en camino / en planta (demora Flexit)
// "En mano" = lo que el cadete lleva encima sin intento (riesgo que NO está en planta).
const n0 = (x) => x || 0;
const tieneReglas = (c) => c.flexRiesgo !== undefined;
export const enMano = (c) => (tieneReglas(c)
  ? n0(c.flexRiesgo) - n0(c.flexRiesgoPlanta) + n0(c.partSinVisita) - n0(c.partSinVisitaPlanta)
  : n0(c.camino) + n0(c.planta));
export const quedaronPlanta = (c) => (tieneReglas(c) ? n0(c.flexRiesgoPlanta) + n0(c.partSinVisitaPlanta) : 0);
export const otrosResultados = (c) => Object.values(c.otroRes || {}).reduce((s, n) => s + n, 0);
export const intentos = (c) => n0(c.nadie) + n0(c.repro) + otrosResultados(c);
// Avance del día: lo entregado + lo que ya tuvo su intento (Nadie, reprogramado, rechazado…).
// Un Nadie o un reprogramado ya está gestionado: suma al progreso, no es un pendiente "abierto".
export const gestionados = (c) => n0(c.e) + intentos(c);

export function proyeccion(c, ahora) {
  if (!c || c.e < 3 || c.primeraEnt === null || c.ultimaEnt === null) return null;
  const desde = c.primeraEnt, hasta = Math.max(c.ultimaEnt, ahora ?? c.ultimaEnt);
  const horas = (hasta - desde) / 60;
  if (horas < 20 / 60) return null;
  const ritmo = c.e / horas;
  if (!(ritmo > 0)) return null;
  const quedan = enMano(c);
  const fin = quedan > 0 ? Math.round((ahora ?? c.ultimaEnt) + (quedan / ritmo) * 60) : null;
  return { ritmo: Math.round(ritmo * 10) / 10, fin };
}

// Estado de un cadete. orden: menor = más urgente (va arriba).
export function estadoCadete(c, ahora) {
  const pr = proyeccion(c, ahora);
  if (c.pend === 0 || (enMano(c) === 0 && (c.e > 0 || intentos(c) > 0))) return { clave: "termino", label: "Terminó", tono: "ok", orden: 6, atencion: false, pr };
  if (c.e === 0 && c.salida === null) {
    return { clave: "no_salio", label: "No salió", tono: "crit", orden: 1, atencion: true, pr };
  }
  if (c.e === 0) {
    const tarde = ahora - c.salida >= MIN_FRENADO;
    return { clave: "sin_entregas", label: tarde ? "Sin entregas" : "Arrancando", tono: tarde ? "crit" : "info", orden: tarde ? 2 : 5, atencion: tarde, pr };
  }
  const ref = c.ultimaEnt ?? c.salida;
  if (ref !== null && ahora - ref >= MIN_FRENADO) {
    // Frenado es peligro solo si hay Flex en riesgo (van a ser demorados). Si lo que le queda son
    // particulares, se informa pero no va a "Para mirar" (pedido 26/10).
    if (tieneReglas(c) && n0(c.flexRiesgo) === 0) {
      return { clave: "frenado_part", label: "Frenado · solo particulares", tono: "neutro", orden: 5, atencion: false, pr };
    }
    return { clave: "frenado", label: "Frenado", tono: "warn", orden: 3, atencion: true, pr };
  }
  if (pr && pr.fin !== null && pr.fin > CORTE_21 && ahora < CORTE_21) {
    return { clave: "tarde", label: "Termina tarde", tono: "warn", orden: 4, atencion: true, pr };
  }
  return { clave: "en_ruta", label: "En ruta", tono: "info", orden: 5, atencion: false, pr };
}

// ALERTA (pedido 26/10): frenado o sin entregas hace 60'+ CON Flex en riesgo → van a ser demorados.
// Misma regla que el vigía del VPS (vps/vigia-datos.js), que avisa por Telegram una vez por cadete.
// Recién desde las 18: antes, los que acaban de salir del depósito figuraban "sin entregas" (pedido 27/10).
export const HORA_ALERTA = 18 * 60;
export function enAlerta(c, ahora) {
  if (ahora !== undefined && ahora !== null && ahora < HORA_ALERTA) return false;
  return !!c.estado && ["frenado", "sin_entregas"].includes(c.estado.clave) && c.estado.atencion && n0(c.flexRiesgo) > 0;
}
export function minSinEntregar(c, ahora) {
  const ref = c.ultimaEnt ?? c.salida;
  return ref === null || ref === undefined ? null : Math.max(0, ahora - ref);
}

export function armarCadetes(porCadete, ahora) {
  return Object.entries(porCadete || {})
    .map(([nombre, c]) => ({ nombre, ...c, estado: estadoCadete(c, ahora) }))
    .sort((a, b) => a.estado.orden - b.estado.orden || n0(b.flexRiesgo) - n0(a.flexRiesgo) || enMano(b) - enMano(a) || a.nombre.localeCompare(b.nombre));
}

// Huecos: tramos de 45' o más SIN ningún movimiento en todo LightData, dentro del reparto.
// Arranca a contar cuando el reparto ya está en marcha (acumulado ≥ 20 entregas o 5% del total),
// para no confundir la mañana tranquila con una caída.
export function huecosDelDia(actividad, entregas, total, hastaMin) {
  const act = actividad || {}, ent = entregas || {};
  const umbral = Math.max(20, Math.round((total || 0) * 0.05));
  let acum = 0, inicio = null;
  for (let b = 0; b < 24 * 60; b += BALDE) {
    acum += ent[String(b)] || 0;
    if (acum >= umbral) { inicio = Math.max(b, INICIO_REPARTO); break; }
  }
  if (inicio === null) return [];
  const fin = Math.min(hastaMin, FIN_REPARTO);
  const huecos = [];
  let desde = null;
  for (let b = inicio; b + BALDE <= fin; b += BALDE) {
    const vacio = !(act[String(b)] > 0);
    if (vacio && desde === null) desde = b;
    if (!vacio && desde !== null) {
      if (b - desde >= MIN_CAIDA) huecos.push({ desde, hasta: b });
      desde = null;
    }
  }
  // el tramo final abierto lo informa saludDatos (es "ahora"), no se lista como hueco cerrado
  return huecos;
}

// Salud del dato: ¿siguen entrando movimientos? Solo alarma si hay gente en la calle y estamos en horario.
export function saludDatos(d, ahora) {
  if (!d) return { nivel: "sin", titulo: "Sin datos todavía", detalle: "" };
  const enCalle = Object.values(d.porCadete || {}).reduce((s, c) => s + (c.camino || 0), 0);
  const huecos = huecosDelDia(d.actividad, d.entregas, d.total, ahora);
  const base = { enCalle, huecos };
  if (!d.conHora) return { ...base, nivel: "warn", titulo: "El Excel no trae la hora de los estados", detalle: "No se puede medir si siguen entrando datos." };
  if (d.ultimoEvento === null) return { ...base, nivel: "ok", titulo: "Todavía no hay movimientos hoy", detalle: "" };
  const sinMov = Math.max(0, ahora - d.ultimoEvento);
  const enHorario = ahora >= INICIO_REPARTO && ahora <= FIN_REPARTO;
  if (enHorario && enCalle > 0 && sinMov >= MIN_CAIDA) {
    return { ...base, nivel: "crit", sinMov, titulo: `Posible caída de datos: ${sinMov} min sin ningún movimiento`,
      detalle: `Hay ${enCalle} envíos en la calle y LightData no registra entregas ni cambios desde las ${hhmm(d.ultimoEvento)}. Revisá si la app de los cadetes o LightData están andando.` };
  }
  if (enHorario && enCalle > 0 && sinMov >= MIN_LENTO) {
    return { ...base, nivel: "warn", sinMov, titulo: `Entran pocos datos: ${sinMov} min sin movimientos`,
      detalle: `Último movimiento a las ${hhmm(d.ultimoEvento)}. Si sigue así, puede ser una caída.` };
  }
  return { ...base, nivel: "ok", sinMov, titulo: "Datos al día", detalle: `Último movimiento ${hace(sinMov)} (${hhmm(d.ultimoEvento)}).` };
}

export function resumen(cadetes, d) {
  const r = { total: 0, e: 0, pend: 0, camino: 0, enRuta: 0, noSalio: 0, atencion: 0, termino: 0, ml: 0, mlE: 0, flexPend: 0, flexRiesgo: 0, repro21: 0, partSinVisita: 0, nadie: 0, repro: 0, otros: 0, quedaronPlanta: 0 };
  for (const c of cadetes) {
    r.total += c.t; r.e += c.e; r.pend += c.pend; r.camino += c.camino;
    r.ml += n0(c.ml); r.mlE += n0(c.mlE); r.flexPend += n0(c.mlPend); r.flexRiesgo += n0(c.flexRiesgo); r.repro21 += n0(c.repro21);
    r.partSinVisita += n0(c.partSinVisita); r.quedaronPlanta += quedaronPlanta(c);
    r.nadie += n0(c.nadie); r.repro += n0(c.repro); r.otros += otrosResultados(c);
    if (c.estado.clave === "termino") r.termino++;
    else if (c.estado.clave === "no_salio") r.noSalio++;
    else r.enRuta++;
    if (c.estado.atencion) r.atencion++;
  }
  r.sinAsignar = (d && d.sinAsignar && d.sinAsignar.t) || 0;
  r.internos = Object.values((d && d.internos) || {}).reduce((s, n) => s + n, 0);
  return r;
}

// ── Cadetes nuevos ──
// El historial sale de la vista cadetes_antiguedad (Supabase, sobre `semanas` de Métricas: una fila por
// cadete con primer día, jornadas y SLA). El vivo y Métricas toman el nombre de la misma columna "Cadete"
// de LightData, pero el bridge junta espacios dobles y a veces cambian mayúsculas: se comparan normalizados.
export const NUEVO_JORNADAS = 5;   // es "nuevo" durante sus primeras 5 jornadas (contando la de hoy)
export const VUELVE_DIAS = 45;     // si no trabajaba hace 45 días o más, se marca "vuelve"
export const RECIENTES_DIAS = 30;  // la solapa Nuevos lista a los que arrancaron en los últimos 30 días

export const normNombre = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();

const diasEntre = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);

export function indexarHistorial(filas) {
  const m = new Map();
  for (const f of filas || []) {
    const k = normNombre(f.cadete);
    const prev = m.get(k);
    // dos variantes del mismo nombre: se queda con la más antigua y suma jornadas
    if (prev) m.set(k, { ...prev, primer_dia: f.primer_dia < prev.primer_dia ? f.primer_dia : prev.primer_dia,
      ultimo_dia: f.ultimo_dia > prev.ultimo_dia ? f.ultimo_dia : prev.ultimo_dia, jornadas: prev.jornadas + f.jornadas });
    else m.set(k, f);
  }
  return m;
}

// ¿Qué tan nuevo es este cadete HOY? null = ya es de la casa.
//   primer → no aparece nunca en Métricas: hoy es su primer día
//   nuevo  → está dentro de sus primeras NUEVO_JORNADAS (jornada = la de hoy, 1-based)
//   vuelve → ya trabajó, pero hacía VUELVE_DIAS o más que no salía
export function antiguedadDe(idx, nombre, hoy) {
  if (!idx) return null;
  const h = idx.get(normNombre(nombre));
  if (!h) return { tipo: "primer", jornada: 1 };
  const previas = h.jornadas - (h.ultimo_dia >= hoy ? 1 : 0); // Métricas puede tener ya la fila de hoy
  const jornada = previas + 1;
  if (jornada <= NUEVO_JORNADAS) return { tipo: "nuevo", jornada, primer: h.primer_dia };
  const ultimaAntes = h.ultimo_dia >= hoy ? null : h.ultimo_dia;
  if (ultimaAntes && diasEntre(ultimaAntes, hoy) >= VUELVE_DIAS) return { tipo: "vuelve", jornada, dias: diasEntre(ultimaAntes, hoy) };
  return null;
}

export const textoAntiguedad = (a) => !a ? "" : a.tipo === "primer" ? "1.er día"
  : a.tipo === "nuevo" ? `Nuevo · ${a.jornada}.ª jornada` : `Vuelve tras ${a.dias} días`;

// Los que arrancaron en los últimos RECIENTES_DIAS, el más nuevo primero.
export function nuevosRecientes(filas, hoy) {
  return (filas || [])
    .filter((f) => f.primer_dia && diasEntre(f.primer_dia, hoy) <= RECIENTES_DIAS)
    .sort((a, b) => (b.primer_dia || "").localeCompare(a.primer_dia || "") || a.cadete.localeCompare(b.cadete));
}

// ── Reclamo de pendientes (botón "Copiar reclamo" de cada cadete) ──
// Mensaje para mandarle al cadete por WhatsApp con lo que todavía tiene que entregar:
// Flex en riesgo primero (la reputación) y después particulares sin visita. Nadie, reprogramados
// y Repro 21hs no entran: ya tuvieron intento, no hay nada que reclamarle.
const lineaDir = (d) => {
  const t = String(d.dir || "").trim();
  if (!t) return d.cliente ? `${d.cliente} (sin dirección)` : `#${d.id} (sin dirección)`;
  const i = t.lastIndexOf(", ");
  return i > 0 ? `${t.slice(0, i)} — ${t.slice(i + 2)}` : t;
};
export function mensajeReclamo(c, ahora) {
  const det = c.detalle || [];
  const flex = det.filter((d) => d.tipo === "riesgo");
  const part = det.filter((d) => d.tipo === "particular");
  const tot = flex.length + part.length;
  if (!tot) return null;
  const nombre = String(c.nombre || "").trim().split(/\s+/)[0] || "";
  const tarde = ahora !== undefined && ahora !== null && ahora >= CORTE_21;
  let n = 0;
  const lista = (xs) => xs.map((d) => `${++n}. ${lineaDir(d)}`);
  const out = [`Hola${nombre ? " " + nombre : ""}! Te ${tot === 1 ? "queda 1 paquete pendiente" : `quedan ${tot} paquetes pendientes`}.`];
  if (flex.length) {
    out.push("", `FLEX (Mercado Libre) — ${flex.length}${tarde ? ", ya pasaron las 21, son urgentes:" : ", tienen que estar entregados antes de las 21:"}`, ...lista(flex));
  }
  if (part.length) out.push("", `PARTICULARES — ${part.length}:`, ...lista(part));
  out.push("", "¿Cómo venís? Avisame si tenés algún problema con alguno.");
  return out.join("\n");
}
