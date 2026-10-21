// devoluciones-accion
// La app no puede hablar con LightData (CORS + credenciales). Esta función, con sesión del equipo,
// dispara el workflow de GitHub "devoluciones.yml", que entra a LightData y:
//   accion "procesar": pasa a "Devuelto al cliente" los remitos firmados (estado procesando)
//   accion "sync":     actualiza el seguimiento
// El token de GitHub vive como secreto (GITHUB_DISPATCH_TOKEN), nunca en el front.

const GITHUB_TOKEN = Deno.env.get("GITHUB_DISPATCH_TOKEN") ?? "";
const REPO = Deno.env.get("GITHUB_REPO") ?? "alejoflexit/Alejo";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MIN_MINUTOS_SYNC = 3;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (estado: number, cuerpo: Record<string, unknown>) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const auth = req.headers.get("Authorization") ?? "";
  const usuario = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON } });
  if (!usuario.ok) return responder(401, { ok: false, motivo: "sin_sesion" });

  const { accion } = await req.json().catch(() => ({ accion: "sync" }));
  const acc = accion === "procesar" ? "todo" : "sync"; // procesar siempre corre también el sync

  const sh = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
  if (acc === "sync") {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/devoluciones_sync?id=eq.1&select=pedido_at`, { headers: sh });
    const f = (await r.json().catch(() => []))[0];
    const min = f?.pedido_at ? (Date.now() - Date.parse(f.pedido_at)) / 60000 : Infinity;
    if (min < MIN_MINUTOS_SYNC) return responder(200, { ok: false, motivo: "reciente", minutos: Math.round(min) });
  }
  if (!GITHUB_TOKEN) return responder(200, { ok: false, motivo: "sin_token" });

  const disparo = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/devoluciones.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { accion: acc } }),
  });
  if (disparo.status !== 204) {
    return responder(200, { ok: false, motivo: "github", status: disparo.status, detalle: (await disparo.text()).slice(0, 200) });
  }
  await fetch(`${SUPABASE_URL}/rest/v1/devoluciones_sync?id=eq.1`, { method: "PATCH", headers: sh, body: JSON.stringify({ pedido_at: new Date().toISOString() }) });
  return responder(200, { ok: true });
});
