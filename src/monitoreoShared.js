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
// Lo que el cadete todavía tiene que gestionar: pendientes SIN ningún intento hoy (ni Nadie ni
// reprogramado — el bridge lo cruza con el historial de LightData). Los que ya tuvieron intento cuentan
// como pendientes del SLA pero no frenan su recorrido. Sin el dato del historial: en la calle + en planta.
export const enMano = (c) => (c.sinGest !== undefined ? c.sinGest : (c.camino || 0) + (c.planta || 0));
export const intentos = (c) => (c.nadie || 0) + (c.reproC || 0) + (c.reproM || 0);

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
    return { clave: "frenado", label: "Frenado", tono: "warn", orden: 3, atencion: true, pr };
  }
  if (pr && pr.fin !== null && pr.fin > CORTE_21 && ahora < CORTE_21) {
    return { clave: "tarde", label: "Termina tarde", tono: "warn", orden: 4, atencion: true, pr };
  }
  return { clave: "en_ruta", label: "En ruta", tono: "info", orden: 5, atencion: false, pr };
}

export function armarCadetes(porCadete, ahora) {
  return Object.entries(porCadete || {})
    .map(([nombre, c]) => ({ nombre, ...c, estado: estadoCadete(c, ahora) }))
    .sort((a, b) => a.estado.orden - b.estado.orden || (b.flexSinGest || 0) - (a.flexSinGest || 0) || enMano(b) - enMano(a) || a.nombre.localeCompare(b.nombre));
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
  const r = { total: 0, e: 0, pend: 0, camino: 0, enRuta: 0, noSalio: 0, atencion: 0, termino: 0, flexPend: 0, flexSinGest: 0, nadie: 0, repro: 0, sinGest: 0 };
  for (const c of cadetes) {
    r.total += c.t; r.e += c.e; r.pend += c.pend; r.camino += c.camino;
    r.flexPend += c.mlPend || 0; r.flexSinGest += c.flexSinGest || 0; r.sinGest += enMano(c);
    r.nadie += c.nadie || 0; r.repro += (c.reproC || 0) + (c.reproM || 0);
    if (c.estado.clave === "termino") r.termino++;
    else if (c.estado.clave === "no_salio") r.noSalio++;
    else r.enRuta++;
    if (c.estado.atencion) r.atencion++;
  }
  r.sinAsignar = (d && d.sinAsignar && d.sinAsignar.t) || 0;
  r.internos = Object.values((d && d.internos) || {}).reduce((s, n) => s + n, 0);
  return r;
}
