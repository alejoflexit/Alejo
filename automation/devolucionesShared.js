// devolucionesShared.js — reglas puras del seguimiento de devoluciones (sin red, testeables).
// Fuente: listado de LightData "Devoluciones" (modules/envios/devoluciones/procesar_listado.php)
// + ficha individual (modules/envios/alta/controlador.php operador=get).

const ESTADO = { EN_PLANTA: 1, EN_CAMINO: 2, ENTREGADO: 5, A_RETIRAR: 7, CANCELADO: 8, ENTREGADO_2DA: 9, DEVUELTO_CLIENTE: 14 };
const CHOFER_DEPOSITO = /devuelto\s*dep[oó]sito/i;

const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// El campo "Logística inversa" lo escribe cada cliente a mano: "SI", "NO", "ENTREGA", "CAMBIO: RETIRAR …".
// Positivo = hay que traer algo de vuelta. Misma idea que la página de Santi, con más negativos.
const NEGATIVOS = new Set(['', '_', '-', 'no', 'n/a', 'na', 'ninguna', 'no es inversa', 'no es cambio', 'entrega', 'flex', 'solo entrega', 'entregar']);
function esCambio(texto) {
  let k = norm(texto).replace(/[.,;:!]+$/g, '');
  if (NEGATIVOS.has(k)) return false;
  if (/^no\b/.test(k) && !/cambi|retir/.test(k)) return false;
  if (k === 's') return true;
  k = k.replace(/si o si/g, ' ');
  return /cambi|retir|devuel|devoluc|inversa|traer|buscar/.test(k) || /(^|[^a-z])si([^a-z]|$)/.test(k);
}

// "19/10/2026 15:20:32" | "19/10/2026 11:24" | "2026-10-19 12:05:52" → ISO con -03:00
function fechaLD(s) {
  const t = String(s || '').trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (m && (Number(m[3]) < 2000 || Number(m[1]) < 1 || Number(m[2]) < 1)) return null; // "00/00/0000" = sin fecha
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] || '00').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}-03:00`;
  m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(t);
  if (m && Number(m[1]) >= 2000 && Number(m[2]) >= 1 && Number(m[3]) >= 1) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}-03:00`;
  return null;
}

// Fila del listado → tipo de devolución (o null si no es devolución)
function tipoDe(linea) {
  if (Number(linea.estado) === ESTADO.CANCELADO) return 'CANCELADO';
  if (Number(linea.campoLog) === 1 && esCambio(linea.logInversa)) return 'CAMBIO';
  // "Devuelto al cliente" sin logística inversa = un cancelado que ya se devolvió
  if (Number(linea.estado) === ESTADO.DEVUELTO_CLIENTE && !Number(linea.campoLog)) return 'CANCELADO';
  return null;
}

// Ficha → fechas clave. historial: [{estado, fecha}], asignaciones: [{operador, fecha}]
function datosFicha(ficha) {
  const hist = Array.isArray(ficha && ficha.historial) ? ficha.historial : [];
  const asig = Array.isArray(ficha && ficha.asignaciones) ? ficha.asignaciones : [];
  const ultimo = (pred, arr) => arr.filter(pred).map((x) => fechaLD(x.fecha)).filter(Boolean).sort().pop() || null;
  const ultAsig = asig.length ? asig[asig.length - 1] : null;
  // Quién lo devolvió: el último chofer "real" antes de la última asignación a "devuelto deposito"
  let cadete_previo = null;
  for (let i = asig.length - 1; i >= 0; i--) {
    if (!CHOFER_DEPOSITO.test(asig[i].operador || '')) continue;
    for (let k = i - 1; k >= 0; k--) {
      const op = String(asig[k].operador || '').replace(/\s+/g, ' ').trim();
      if (op && !/desasignado|devuelto|dep[oó]sito|repro\s*gramar|lightdata/i.test(op)) { cadete_previo = op; break; }
    }
    break;
  }
  const header = (ficha && ficha.header) || {};
  const valor = Number(String(header.valor_declarado || '').replace(',', '.'));
  return {
    fecha_cancelado: ultimo((h) => Number(h.estado) === ESTADO.CANCELADO, hist),
    fecha_retiro: ultimo((h) => [ESTADO.ENTREGADO, ESTADO.ENTREGADO_2DA].includes(Number(h.estado)), hist),
    fecha_devuelto_cliente: ultimo((h) => Number(h.estado) === ESTADO.DEVUELTO_CLIENTE, hist),
    fecha_deposito: ultimo((a) => CHOFER_DEPOSITO.test(a.operador || ''), asig),
    cadete: ultAsig ? String(ultAsig.operador || '').replace(/\s+/g, ' ').trim() : null,
    cadete_asignado_at: ultAsig ? fechaLD(ultAsig.fecha) : null, // la última asignación = al cadete actual
    valor: Number.isFinite(valor) && valor > 0 ? valor : null,
    direccion: String(header.destination_shipping_address_line || '').trim() || null,
    localidad: String(header.destination_city_name || '').trim() || null,
    cadete_previo,
  };
}

module.exports = { ESTADO, CHOFER_DEPOSITO, esCambio, fechaLD, tipoDe, datosFicha, norm };
