// bridge — pasamanos autenticado hacia el bridge de LightData del VPS (seguridad, 13/11/2026).
//
// Antes la app le pegaba directo al VPS con la clave x-bridge-key escrita en el código del
// frontend. Como el repo es público y el bundle se descarga, cualquiera podía leer el GPS de los
// cadetes (/geo), el reparto del día, la colecta o el QR de un envío sin tener usuario.
//
// Ahora: la app llama a /functions/v1/bridge/<ruta>?<query> con la sesión del usuario. Esta
// función valida que haya un usuario logueado, que la ruta esté en la lista permitida, y recién
// ahí le pega al VPS con la clave, que vive SOLO como secreto de la función (BRIDGE_KEY).
//
// Secretos: BRIDGE_KEY (obligatorio), BRIDGE_BASE (opcional, default el VPS de Flexit).

const BRIDGE_KEY = Deno.env.get("BRIDGE_KEY") ?? "";
const BRIDGE_BASE = (Deno.env.get("BRIDGE_BASE") ?? "https://srv1801226.hstgr.cloud/bridge").replace(/\/$/, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Rutas que usa la app hoy. Cualquier otra se rechaza.
const RUTAS = new Set(["reparto", "colecta", "colecta-detalle", "zonas", "geo", "envio-qr"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, cache-control",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const responder = (estado: number, cuerpo: Record<string, unknown>) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });

// Cache corto de tokens válidos: Monitoreo y Colectas consultan seguido y no hace falta
// preguntarle a Auth en cada pedido. Un token revocado sigue andando como mucho 60 s.
const validos = new Map<string, number>();
async function usuarioValido(auth: string): Promise<boolean> {
  const ahora = Date.now();
  const hasta = validos.get(auth);
  if (hasta && hasta > ahora) return true;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON } });
  if (!r.ok) return false;
  if (validos.size > 500) validos.clear();
  validos.set(auth, ahora + 60_000);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return responder(405, { ok: false, motivo: "metodo" });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !(await usuarioValido(auth))) {
    return responder(401, { ok: false, motivo: "sin_sesion" });
  }
  if (!BRIDGE_KEY) return responder(500, { ok: false, motivo: "falta_BRIDGE_KEY" });

  const url = new URL(req.url);
  // /functions/v1/bridge/<ruta>  →  el path que ve la función es /bridge/<ruta>
  const ruta = url.pathname.replace(/^.*\/bridge\/?/, "").replace(/\/+$/, "");
  if (ruta === "reasignar-deposito") return await reasignarDeposito(url);
  if (!RUTAS.has(ruta)) return responder(404, { ok: false, motivo: "ruta_no_permitida" });

  try {
    const r = await fetch(`${BRIDGE_BASE}/${ruta}${url.search}`, {
      headers: { "x-bridge-key": BRIDGE_KEY },
      signal: AbortSignal.timeout(55_000),
    });
    const cuerpo = await r.arrayBuffer();
    return new Response(cuerpo, {
      status: r.status,
      headers: { ...CORS, "Content-Type": r.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return responder(502, { ok: false, motivo: "bridge_sin_respuesta", detalle: String((e as Error)?.message ?? e).slice(0, 120) });
  }
});

// ---- reasignar-deposito (18/11/2026): la única ruta que ESCRIBE en LightData ----
// Le saca al cadete el envío que se acaba de ingresar en Devoluciones (lo pasa a "devuelto deposito").
// Solo acepta envíos que en devoluciones_gestion tienen ingreso_deposito_at de los últimos 3 días y todavía
// no están reasignados: así nadie puede usar la ruta para mover envíos cualquiera. Marca el resultado igual
// que el workflow devoluciones.yml (que queda de respaldo para lo que falle acá).
async function reasignarDeposito(url: URL): Promise<Response> {
  if (!SERVICE) return responder(500, { ok: false, motivo: "falta_service_key" });
  const pedidos = [...new Set((url.searchParams.get("dids") ?? "").split(",").map((x) => x.trim()).filter((x) => /^\d{3,10}$/.test(x)))].slice(0, 20);
  if (!pedidos.length) return responder(400, { ok: false, motivo: "dids" });
  const sh = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=minimal" };
  const hace3 = new Date(Date.now() - 3 * 864e5).toISOString();
  const g = await fetch(`${SUPABASE_URL}/rest/v1/devoluciones_gestion?select=did&did=in.(${pedidos.join(",")})&ingreso_deposito_at=gte.${encodeURIComponent(hace3)}&ld_reasignado_at=is.null`, { headers: sh });
  const dids = ((await g.json().catch(() => [])) as { did: number }[]).map((x) => Number(x.did));
  if (!dids.length) return responder(200, { ok: true, reasignados: [], nada: true });
  let data: { ok?: number[]; mal?: unknown[]; mensaje?: string; error?: string } = {};
  try {
    const r = await fetch(`${BRIDGE_BASE}/reasignar-deposito?dids=${dids.join(",")}`, { headers: { "x-bridge-key": BRIDGE_KEY }, signal: AbortSignal.timeout(50_000) });
    data = await r.json().catch(() => ({}));
    if (!r.ok) return responder(200, { ok: false, motivo: "bridge", status: r.status, detalle: String(data.error ?? "").slice(0, 160) });
  } catch (e) {
    return responder(200, { ok: false, motivo: "bridge_sin_respuesta", detalle: String((e as Error)?.message ?? e).slice(0, 120) });
  }
  const ok = (data.ok ?? []).map(Number).filter((d) => dids.includes(d));
  if (ok.length) {
    const ahora = new Date().toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/devoluciones_gestion?did=in.(${ok.join(",")})`, { method: "PATCH", headers: sh, body: JSON.stringify({ ld_reasignado_at: ahora, ld_reasignado_error: null }) });
    // detalle_at null = que el próximo sync relea la ficha (chofer, quién lo trajo)
    await fetch(`${SUPABASE_URL}/rest/v1/devoluciones?did=in.(${ok.join(",")})`, { method: "PATCH", headers: sh, body: JSON.stringify({ en_deposito_ld: true, detalle_at: null }) });
  }
  return responder(200, { ok: true, reasignados: ok, mal: data.mal ?? [], mensaje: data.mensaje ?? "" });
}
