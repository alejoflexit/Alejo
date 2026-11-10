/**
 * Doble bulto → planilla "FUERA <MES> <AA>", solapa DOBLE BULTOS (Alejo, 10/11/2026)
 *
 * Corre todos los días a las 17 hs con la cuenta de Alejo (Google Apps Script, script.google.com).
 * Trae de Supabase los doble bultos escaneados en la app y los agrega al final de la solapa
 * DOBLE BULTOS del archivo del mes en que se escanearon. Columnas: FECHA · Cliente · Nro de venta ·
 * Dirección · Num bultos · Zona (la G "Dato extra" no se toca). En la H ("Cargado por") deja
 * "Bot · dd/MM HH:mm" para distinguir cada tanda de lo que se cargó a mano.
 *
 * Reglas:
 *  - Nunca duplica: antes de escribir lee la columna C (Nro de venta) y saltea lo que ya está,
 *    aunque lo haya pegado alguien a mano.
 *  - Solo manda filas listas: con dirección, o que ya llevan 3 días sin aparecer en LightData
 *    (esas van con la dirección vacía, igual que en la app: "No apareció en LightData").
 *  - Mira el mes actual y el anterior: un paquete del 30/11 que recién tiene dirección el 02/12
 *    va al archivo de NOVIEMBRE, que es cuando se escaneó.
 *  - Si no encuentra el archivo del mes o la solapa, no escribe en ningún otro lado: manda un mail.
 *
 * Instalación (una sola vez): ver ESTADO-DOBLE-BULTO.md → "Pegado automático en la planilla".
 * Propiedades del script: SUPABASE_URL, SUPABASE_KEY (service_role).
 */

const SOLAPA = 'DOBLE BULTOS';
const DIAS_SIN_DATOS = 3;
const TZ = 'America/Argentina/Buenos_Aires';
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

// ---- Lo que corre a las 17 hs ----------------------------------------------------------
function exportarDobleBultos() { return correr_(false); }

// ---- Prueba: muestra en el registro qué agregaría, sin escribir nada ---------------------
function probar() { return correr_(true); }

// ---- Instalación: deja programado el disparo diario de las 17 hs -------------------------
function instalar() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SUPABASE_URL') || !p.getProperty('SUPABASE_KEY')) {
    throw new Error('Faltan las propiedades SUPABASE_URL y SUPABASE_KEY (Configuración del proyecto → Propiedades del script).');
  }
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'exportarDobleBultos')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('exportarDobleBultos').timeBased().atHour(17).everyDays(1).inTimezone(TZ).create();
  Logger.log('Listo: corre todos los días entre las 17 y las 18 hs.');
  probar();
}

// =========================================================================================
function correr_(soloPrueba) {
  const ahora = new Date();
  const filas = traerFilas_(ahora).filter((f) => lista_(f, ahora));
  const porMes = {};
  filas.forEach((f) => {
    const k = Utilities.formatDate(new Date(f.escaneado_at), TZ, 'yyyy-MM');
    (porMes[k] = porMes[k] || []).push(f);
  });

  const problemas = [];
  const hechos = [];
  Object.keys(porMes).sort().forEach((k) => {
    const [anio, mes] = k.split('-').map(Number);
    const nombre = `FUERA ${MESES[mes - 1]} ${String(anio).slice(2)}`;
    const ss = buscarPlanilla_(mes, anio);
    if (!ss) { problemas.push(`No encontré el archivo "${nombre}" (${porMes[k].length} paquetes esperando).`); return; }
    const sh = ss.getSheets().find((s) => normal_(s.getName()) === normal_(SOLAPA));
    if (!sh) { problemas.push(`El archivo "${ss.getName()}" no tiene la solapa ${SOLAPA}.`); return; }

    const ultima = ultimaFila_(sh);
    const ya = new Set(ultima > 1
      ? sh.getRange(2, 3, ultima - 1, 1).getDisplayValues().map((r) => codigo_(r[0])).filter(Boolean)
      : []);
    const nuevas = porMes[k].filter((f) => !ya.has(codigo_(f.codigo)));
    if (!nuevas.length) return;

    const valores = nuevas.map((f) => [
      Utilities.formatDate(new Date(f.escaneado_at), TZ, 'dd/MM'),
      f.cliente || '',
      String(f.codigo),
      f.direccion || '',
      Number(f.bultos) || '',
      f.localidad || '',
    ]);
    hechos.push(`${ss.getName()}: ${nuevas.length} fila${nuevas.length === 1 ? '' : 's'}`);
    if (soloPrueba) { valores.forEach((v) => Logger.log(`[prueba] ${ss.getName()} ← ${v.join(' · ')}`)); return; }

    const desde = ultima + 1;
    if (sh.getMaxRows() < desde + valores.length - 1) sh.insertRowsAfter(sh.getMaxRows(), desde + valores.length - 1 - sh.getMaxRows());
    // El Nro de venta como texto: los códigos largos (16 dígitos) se rompen si Sheets los toma como número
    sh.getRange(desde, 3, valores.length, 1).setNumberFormat('@');
    sh.getRange(desde, 1, valores.length, 6).setValues(valores);
    // Columna H: marca de la tanda (lo cargado a mano queda con la H vacía)
    if (!String(sh.getRange(1, 8).getValue()).trim()) sh.getRange(1, 8).setValue('Cargado por');
    const marca = 'Bot · ' + Utilities.formatDate(ahora, TZ, 'dd/MM HH:mm');
    sh.getRange(desde, 8, valores.length, 1).setValues(valores.map(() => [marca]));
  });

  Logger.log(hechos.length ? `${soloPrueba ? 'Prueba (no escribió nada) — agregaría' : 'Agregado'} → ${hechos.join(' | ')}` : 'Nada nuevo para agregar.');
  if (problemas.length) {
    Logger.log('Problemas: ' + problemas.join(' / '));
    if (!soloPrueba) {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Doble bultos: no se pudo pasar a la planilla',
        problemas.join('\n') + '\n\nSe vuelve a intentar mañana a las 17 hs. Revisá que el archivo del mes se llame "FUERA <MES> <AA>" y tenga la solapa DOBLE BULTOS.');
    }
  }
  return { hechos, problemas };
}

// Doble bultos desde el 1° del mes anterior (hora AR)
function traerFilas_(ahora) {
  const p = PropertiesService.getScriptProperties();
  const url = p.getProperty('SUPABASE_URL').replace(/\/$/, '');
  const key = p.getProperty('SUPABASE_KEY');
  const [anio, mes] = Utilities.formatDate(ahora, TZ, 'yyyy-M').split('-').map(Number);
  const ini = new Date(Date.UTC(mes === 1 ? anio - 1 : anio, mes === 1 ? 11 : mes - 2, 1, 3)); // 00:00 AR
  const q = `${url}/rest/v1/doble_bultos?escaneado_at=gte.${ini.toISOString()}` +
    '&select=codigo,cliente,direccion,localidad,bultos,escaneado_at,cruzado_at&order=escaneado_at.asc&limit=5000';
  const r = UrlFetchApp.fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error(`Supabase respondió ${r.getResponseCode()}: ${r.getContentText().slice(0, 200)}`);
  return JSON.parse(r.getContentText());
}

function lista_(f, ahora) {
  if (f.direccion || f.cruzado_at) return true;
  return (ahora - Date.parse(f.escaneado_at)) / 864e5 >= DIAS_SIN_DATOS;
}

// "FUERA NOVIEMBRE 26" — tolera mayúsculas, tildes, espacios de más, año con 4 dígitos y SETIEMBRE.
// Si hay varios con el mismo nombre, usa el último modificado.
function buscarPlanilla_(mes, anio) {
  const meses = mes === 9 ? ['SEPTIEMBRE', 'SETIEMBRE'] : [MESES[mes - 1]];
  const aa = String(anio).slice(2);
  const ok = new RegExp(`^FUERA (${meses.join('|')}) (20)?${aa}$`);
  const it = DriveApp.searchFiles("title contains 'FUERA' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
  let mejor = null;
  while (it.hasNext()) {
    const f = it.next();
    if (!ok.test(normal_(f.getName()))) continue;
    if (!mejor || f.getLastUpdated() > mejor.getLastUpdated()) mejor = f;
  }
  return mejor ? SpreadsheetApp.openById(mejor.getId()) : null;
}

// Última fila con algo en A:F (las filas vacías con formato no cuentan)
function ultimaFila_(sh) {
  const n = sh.getLastRow();
  if (n < 2) return 1;
  const v = sh.getRange(1, 1, n, 6).getDisplayValues();
  for (let i = v.length - 1; i >= 0; i--) if (v[i].some((c) => String(c).trim() !== '')) return i + 1;
  return 1;
}

function codigo_(v) { return String(v || '').replace(/^#/, '').replace(/\s+/g, '').trim(); }
function normal_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
