// Extraviados y rotos — lógica pura (sin React ni red), testeada en extraviadosShared.test.js.
//
// Un paquete extraviado o roto se le descuenta al cliente de la factura y, si corresponde, al
// transportista de su pago. El descuento al transportista se materializa como filas de
// pagos_ajustes (una por cuota, una por semana), así Liquidaciones lo muestra solo, sin lógica nueva.

export const norm = (s) => String(s == null ? '' : s)
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// "92.199,00" | "92199.00" | "92199" | "$ 92,199.00" → 92199 (null si no hay número)
export function parseValor(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v).replace(/[^\d.,-]/g, '');
  if (!t) return null;
  const coma = t.lastIndexOf(','), punto = t.lastIndexOf('.');
  if (coma > -1 && punto > -1) {
    // el último separador es el decimal
    t = coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (coma > -1) {
    // "92199,5" decimal · "92,199" miles
    t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if ((t.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(t)) {
    t = t.replace(/\./g, ''); // "92.199" miles
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Valor a descontar: el cargado a mano manda sobre el declarado de LightData
export function montoDe(r) {
  const m = parseValor(r && r.valor_manual);
  if (m != null && m > 0) return m;
  const d = parseValor(r && r.valor_declarado);
  return d != null && d > 0 ? d : null;
}

// Reparte un monto en n cuotas enteras; la última absorbe el redondeo (suman exacto)
export function cuotasDe(monto, n) {
  const total = Math.round(Number(monto) || 0);
  const k = Math.max(1, Math.min(52, Math.floor(Number(n) || 1)));
  if (total <= 0) return [];
  const base = Math.floor(total / k);
  const out = Array(k).fill(base);
  out[k - 1] = total - base * (k - 1);
  return out;
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = d.getUTCDay();
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}
export const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
export const ddmm = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}` : ''; };
export const semanaTxt = (lunes) => (lunes ? `${ddmm(lunes)} al ${ddmm(addDays(lunes, 5))}` : '');

// Filas de pagos_ajustes que genera un extraviado (una por semana, desde semana_inicio)
export function planDescuento(r) {
  const monto = montoDe(r);
  const n = Math.max(1, Number(r.cuotas) || 1);
  if (!monto || !r.cadete || !r.semana_inicio) return [];
  const tipo = r.tipo === 'roto' ? 'Roto' : 'Extraviado';
  const ref = [ddmm(r.fecha), r.cliente, r.codigo].filter(Boolean).join(' · ');
  return cuotasDe(monto, n).map((m, i) => ({
    semana_label: addDays(r.semana_inicio, 7 * i),
    cadete: r.cadete,
    concepto: `${tipo} ${ref}${n > 1 ? ` (cuota ${i + 1}/${n})` : ''}`.slice(0, 200),
    monto: m,
    extraviado_id: r.id,
    cuota: i + 1,
  }));
}

// Nombre con el que cobra en Liquidaciones a partir del cadete de LightData:
// alias "merge" → paga_como; si no, el nombre de cadetes_tarifas que coincide.
export function cadeteDePago(cadeteLD, tarifas = [], alias = []) {
  const k = norm(cadeteLD);
  if (!k) return '';
  const al = alias.find((a) => norm(a.nombre_lightdata) === k);
  const canon = al && al.regla === 'merge' && al.paga_como ? al.paga_como : cadeteLD;
  const t = tarifas.find((x) => norm(x.nombre_lightdata) === norm(canon));
  return t ? t.nombre_lightdata : '';
}

// Cuál cierre corresponde a una cuota (mismo criterio que Liquidaciones: nombre normalizado)
export const cierreDe = (cierres, semana, cadete) =>
  (cierres || []).find((c) => c.semana_label === semana && norm(c.cadete) === norm(cadete)) || null;

// Estado de las cuotas cargadas de un extraviado
export function estadoCuotas(ajustes, cierres) {
  const filas = [...(ajustes || [])].sort((a, b) => (a.semana_label < b.semana_label ? -1 : 1));
  const pagadas = filas.filter((a) => { const c = cierreDe(cierres, a.semana_label, a.cadete); return c && c.pagado; });
  const descontado = pagadas.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  const total = filas.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  const proxima = filas.find((a) => !pagadas.includes(a));
  return { filas, n: filas.length, pagadas: pagadas.length, descontado, total, resta: total - descontado, proxima: proxima ? proxima.semana_label : null };
}

// Código cargado (IDML, tracking o ID de LightData) → filtro de envios_busqueda
export const codigoLimpio = (c) => String(c || '').trim().replace(/^#/, '').replace(/\s+/g, '');
export function filtroEnvio(codigo) {
  const c = codigoLimpio(codigo);
  if (!/^[\w-]{3,80}$/.test(c)) return null;
  return `or=(id_venta_ml.eq.${c},tracking.eq.${c},id_interno.eq.${c})`;
}
