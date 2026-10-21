// devolucionesShared.js — en qué etapa está cada devolución y cuántos días lleva.
// Datos: tabla devoluciones (sync de LightData) + devoluciones_gestion (lo que marca el equipo).
//
// Etapas:
//   calle     → todavía no volvió al depósito
//               cancelado: no tiene chofer "devuelto deposito" · cambio: retirado y sin ingreso marcado
//   retiro    → cambio que el cadete todavía no retiró al comprador (no cuenta como "en la calle")
//   deposito  → en el depósito, falta devolverlo al cliente
//               cancelado: chofer "devuelto deposito" · cambio: ingreso marcado en la app
//   devuelto  → estado LightData 14 "Devuelto al cliente"
// Días: en la calle desde la cancelación (cambios: desde el retiro); en depósito desde el ingreso.

export const LIMITE_CALLE = 7;
export const LIMITE_DEPOSITO = 15;
export const MARCAS = {
  reclamado: "Reclamado al cadete",
  extraviado: "Extraviado",
  descartado: "Descartado",
};
// Marcas que cierran el caso: no se cuentan en los totales (no hay nada más que hacer)
export const MARCAS_CIERRAN = ["extraviado", "descartado"];

const DIA = 24 * 3600 * 1000;
const RETIRADO = [5, 9]; // Entregado / Entregado 2da visita

export function diasDesde(iso, ahora = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((ahora - t) / DIA)) : null;
}

export function armarCaso(d, g = {}, ahora = Date.now()) {
  const tipo = g.tipo_override || d.tipo;
  if (tipo === "NO_ES") return null;
  let etapa, desde;
  if (d.estado_ld === 14) {
    etapa = "devuelto"; desde = d.fecha_devuelto_cliente || d.fecha_dev_ld;
  } else if (tipo === "CANCELADO") {
    if (d.en_deposito_ld) { etapa = "deposito"; desde = d.fecha_deposito || d.fecha_cancelado || d.fecha_alta; }
    else { etapa = "calle"; desde = d.fecha_cancelado || d.fecha_alta; }
  } else if (g.ingreso_deposito_at || d.en_deposito_ld) {
    etapa = "deposito"; desde = g.ingreso_deposito_at || d.fecha_deposito || d.fecha_retiro;
  } else if (d.fecha_retiro || RETIRADO.includes(d.estado_ld)) {
    etapa = "calle"; desde = d.fecha_retiro || d.fecha_alta;
  } else {
    etapa = "retiro"; desde = d.fecha_alta;
  }
  const dias = diasDesde(desde, ahora);
  const limite = etapa === "calle" ? LIMITE_CALLE : etapa === "deposito" ? LIMITE_DEPOSITO : null;
  const marca = g.marca || null;
  return {
    ...d, tipo, etapa, desde, dias, marca, marca_nota: g.marca_nota || "", marca_por: g.marca_por || "", marca_at: g.marca_at || null,
    reclamo_at: g.reclamo_at || null,
    ingreso_deposito_at: g.ingreso_deposito_at || null, ingreso_por: g.ingreso_por || "",
    vencido: limite !== null && dias !== null && dias > limite,
    cerrado: MARCAS_CIERRAN.includes(marca),
  };
}

export function armarCasos(devoluciones, gestion, ahora = Date.now()) {
  const g = new Map((gestion || []).map((x) => [Number(x.did), x]));
  return (devoluciones || []).map((d) => armarCaso(d, g.get(Number(d.did)), ahora)).filter(Boolean);
}

export function resumen(casos) {
  const vivos = casos.filter((c) => !c.cerrado);
  const calle = vivos.filter((c) => c.etapa === "calle");
  const deposito = vivos.filter((c) => c.etapa === "deposito");
  const valor = (arr) => arr.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  return {
    calle: calle.length, calleValor: valor(calle),
    deposito: deposito.length, depositoValor: valor(deposito),
    calleVencidos: calle.filter((c) => c.vencido).length,
    depositoVencidos: deposito.filter((c) => c.vencido).length,
    retiro: vivos.filter((c) => c.etapa === "retiro").length,
    devueltos: casos.filter((c) => c.etapa === "devuelto").length,
    marcados: casos.filter((c) => c.marca).length,
  };
}

// Orden de trabajo: primero lo vencido, después lo más caro, después lo más viejo
export function ordenar(a, b) {
  if (a.vencido !== b.vencido) return a.vencido ? -1 : 1;
  const v = (Number(b.valor) || 0) - (Number(a.valor) || 0);
  if (v) return v;
  return (b.dias || 0) - (a.dias || 0);
}

// ---- Reclamos por WhatsApp al cadete (idea tomada de la página de Santi) ----
// Choferes que no son personas: no se les reclama
export const CHOFER_FICTICIO = /devuelto|dep[oó]sito|repro\s*gramar|desasignado|lightdata|^\s*$/i;
const ddmm = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit" }) : "?"; };

export function reclamosPorCadete(casos) {
  const m = new Map();
  for (const c of casos) {
    if (c.etapa !== "calle" || c.cerrado) continue;
    const k = CHOFER_FICTICIO.test(c.cadete || "") ? "" : c.cadete;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c);
  }
  return [...m.entries()].map(([cadete, lista]) => ({
    cadete, casos: lista.sort((a, b) => (b.dias || 0) - (a.dias || 0)),
    valor: lista.reduce((s, c) => s + (Number(c.valor) || 0), 0),
    vencidos: lista.filter((c) => c.vencido).length,
  })).sort((a, b) => (a.cadete ? 0 : 1) - (b.cadete ? 0 : 1) || b.casos.length - a.casos.length);
}

export function mensajeReclamo(cadete, casos) {
  const nombre = String(cadete || "").trim().split(/\s+/)[0] || "";
  const n = casos.length;
  const lineas = casos.map((c, i) => {
    const tipo = c.tipo === "CAMBIO" ? "CAMBIO" : "CANCELADO";
    const dir = [c.direccion, c.localidad].filter(Boolean).join(", ") || `CP ${c.cp || "?"}`;
    let l = `${i + 1}) ${tipo} — ${dir} — lo tenés desde el ${ddmm(c.desde)} (${c.dias ?? "?"} días)`;
    if (c.ml_venta_id || c.tracking) l += `\n   Venta/tracking: ${c.ml_venta_id || c.tracking}`;
    if (c.tipo === "CAMBIO" && c.li_texto) l += `\n   ↳ ${c.li_texto}`;
    return l;
  });
  return `Hola${nombre ? " " + nombre : ""}! Control de devoluciones de Flexit.\nTenés ${n} paquete${n > 1 ? "s" : ""} para devolver al depósito:\n\n${lineas.join("\n")}\n\nTraelo${n > 1 ? "s" : ""} en tu próxima carga, por favor. ¡Gracias!`;
}

// QR del remito: solo el código; la lista de envíos se busca en la base (no se puede falsificar desde el papel)
export const QR_PREFIJO = "FLEXIT-RD:";
export function codigoDeQR(texto) {
  const m = /FLEXIT-RD:(RD-\d+)/.exec(String(texto || ""));
  return m ? m[1] : null;
}

// Un remito por cliente, de hasta 25 envíos (entra en una hoja con lugar para la firma)
export const MAX_POR_REMITO = 25;
export function agruparParaRemitos(casos) {
  const porCliente = new Map();
  for (const c of casos) {
    const k = c.cliente || "(sin cliente)";
    if (!porCliente.has(k)) porCliente.set(k, []);
    porCliente.get(k).push(c);
  }
  const out = [];
  for (const [cliente, lista] of porCliente) {
    for (let i = 0; i < lista.length; i += MAX_POR_REMITO) out.push({ cliente, casos: lista.slice(i, i + MAX_POR_REMITO) });
  }
  return out;
}
