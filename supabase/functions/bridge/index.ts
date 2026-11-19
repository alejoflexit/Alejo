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
