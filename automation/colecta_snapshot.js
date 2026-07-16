// colecta_snapshot.js
// Fase 0 de spec-anticipo-dia-zonas: snapshot horario de la colecta del día.
// Pega al bridge del VPS (/bridge/colecta), deriva zona por chofer desde
// cadete_topes (+ pagos_cadete_alias) y appendea UNA fila en colecta_snapshots.
//
// AISLADO: escribe SOLO en `colecta_snapshots`. No toca colectas, pagos ni métricas.
// Sin puppeteer ni supabase-js: fetch directo (patrón de los syncs existentes).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Bridge LightData (VPS) — solo lectura; la key ya es visible en el bundle de la app
// (riesgo aceptado, ver spec-lightdata-bridge). Misma key que src/Colectas.js.
const BRIDGE_URL = "https://srv1801226.hstgr.cloud/bridge/colecta";
const BRIDGE_KEY = "db1d987c9cfbd82b949d61f31ffcedaceceddd10a19b556b";

// misma normalización que src/Colectas.js
function normNombre(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fechaAR() {
  // fecha calendario en Argentina (UTC-3, sin DST)
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return {
    iso: d.toISOString().slice(0, 10), // YYYY-MM-DD (para Supabase)
    ld: `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`, // DD/MM/YYYY (para el bridge)
  };
}

async function sbGet(pathQ) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathQ}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${pathQ}: ${res.status}`);
  return res.json();
}

async function main() {
  const { iso, ld } = fechaAR();

  // 1) colecta del día desde el bridge
  const r = await fetch(`${BRIDGE_URL}?fecha=${encodeURIComponent(ld)}`, {
    headers: { "x-bridge-key": BRIDGE_KEY },
  });
  if (!r.ok) throw new Error(`bridge ${r.status}`);
  const json = await r.json();
  const choferes = json.choferes || [];

  // 2) chofer → zona (cadete_topes vía alias)
  const [topes, alias] = await Promise.all([
    sbGet("cadete_topes?select=cadete,zonas&activo=eq.true"),
    sbGet("pagos_cadete_alias?select=nombre_lightdata,paga_como"),
  ]);
  const aliasMap = new Map();
  alias.forEach((a) => { if (a.paga_como) aliasMap.set(normNombre(a.nombre_lightdata), normNombre(a.paga_como)); });
  const zonaMap = new Map();
  topes.forEach((t) => zonaMap.set(normNombre(t.cadete), t.zonas || "sin_zona"));

  // 3) agregación
  const porChofer = {};
  const porZona = {};
  let total = 0;
  choferes.forEach((row) => {
    const cant = Number(row.cantidad || 0);
    const n = normNombre(row.chofer);
    const canon = aliasMap.get(n) || n;
    // clave por_zona = string `zonas` completo de cadete_topes (un cadete puede cubrir 2 zonas;
    // no se inventa el reparto — supuesto marcado en la spec)
    const zona = zonaMap.get(canon) || "sin_zona";
    porChofer[canon] = (porChofer[canon] || 0) + cant;
    porZona[zona] = (porZona[zona] || 0) + cant;
    total += cant;
  });

  // 4) append del snapshot (nunca pisa: cada corrida = fila nueva)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/colecta_snapshots`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify([{ fecha: iso, total, por_zona: porZona, por_chofer: porChofer }]),
  });
  if (!res.ok) throw new Error(`insert snapshot: ${res.status} ${await res.text()}`);
  console.log(`snapshot OK — ${iso}: total=${total}, zonas=${Object.keys(porZona).length}, choferes=${Object.keys(porChofer).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
