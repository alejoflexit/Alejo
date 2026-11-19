// xubio
// (deploy: 2026-11-19, con --yes)
// Puente entre la app y la API de Xubio (etapa 2 de facturas por link — ver ESTADO-FACTURAS-LINK.md).
// Las credenciales viven SOLO acá como secretos de la función: XUBIO_CLIENT_ID / XUBIO_SECRET_ID
// (Supabase › Edge Functions › Secrets). Nunca van al front: el repo es público.
//
// Acciones (POST {accion}):
//   probar  → saca un token, mira qué expone la API para compras/proveedores y trae 1 comprobante
//             de compra de ejemplo para copiar exactamente cómo los carga Adrián. No escribe nada.
//
// Solo admin (usuarios_permisos.rol = 'admin'), igual que admin-usuarios.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const XUBIO_ID = Deno.env.get("XUBIO_CLIENT_ID") ?? "";
const XUBIO_SECRET = Deno.env.get("XUBIO_SECRET_ID") ?? "";
const XUBIO = "https://xubio.com/API/1.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (estado: number, cuerpo: Record<string, unknown>) =>
  new Response(JSON.stringify(cuerpo, null, 1), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });

const svc = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });

async function leer(r: Response) {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t.slice(0, 600); }
}

async function tokenXubio(): Promise<{ ok: boolean; token?: string; status?: number; detalle?: unknown }> {
  if (!XUBIO_ID || !XUBIO_SECRET) return { ok: false, detalle: "Faltan los secretos XUBIO_CLIENT_ID / XUBIO_SECRET_ID" };
  const r = await fetch(`${XUBIO}/TokenEndpoint`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${XUBIO_ID}:${XUBIO_SECRET}`),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  const j = await leer(r);
  if (!r.ok || !j?.access_token) return { ok: false, status: r.status, detalle: j };
  return { ok: true, token: j.access_token };
}

async function getXubio(token: string, path: string) {
  const r = await fetch(`${XUBIO}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  return { status: r.status, cuerpo: await leer(r), headers: Object.fromEntries([...r.headers].filter(([k]) => /page|total|count|link/i.test(k))) };
}

// Resumen del swagger: qué rutas tocan compras/proveedores/pagos/adjuntos y qué campos lleva el alta.
async function mapaApi() {
  const r = await fetch(`${XUBIO}/swagger.json`);
  if (!r.ok) return { status: r.status };
  const sw = await r.json();
  const rutas: Record<string, string[]> = {};
  for (const [p, ops] of Object.entries<any>(sw.paths || {})) {
    if (/compra|proveedor|pago|adjunt|archivo|documento|cuenta|centro|talonario|tipo/i.test(p)) rutas[p] = Object.keys(ops);
  }
  const defs: Record<string, unknown> = {};
  for (const [n, d] of Object.entries<any>(sw.definitions || sw.components?.schemas || {})) {
    if (/ComprobanteCompra|Proveedor|OrdenPago|Adjunt|Archivo/i.test(n)) {
      defs[n] = Object.fromEntries(Object.entries<any>(d.properties || {}).map(([k, v]) => [k, v.type || v.$ref || (v.items && (v.items.$ref || v.items.type)) || "?"]));
    }
  }
  return { host: sw.host, basePath: sw.basePath, seguridad: sw.securityDefinitions || sw.components?.securitySchemes, rutas, defs };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder(405, { ok: false, error: "Método no permitido" });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return responder(401, { ok: false, error: "Sin sesión" });
  const ru = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON } });
  if (!ru.ok) return responder(401, { ok: false, error: "Sesión vencida" });
  const yo = await ru.json();
  const rp = await svc(`/rest/v1/usuarios_permisos?select=rol&user_id=eq.${yo.id}`);
  const filaYo = (await leer(rp))?.[0];
  if (!filaYo || filaYo.rol !== "admin") return responder(403, { ok: false, error: "Solo un administrador puede usar esto" });

  const { accion } = await req.json().catch(() => ({}));
  if (accion !== "probar") return responder(400, { ok: false, error: "Acción desconocida" });

  // ¿Se corrió la migración de facturas por link?
  const mig = await svc(`/rest/v1/facturas_comprobantes?select=id&limit=1`);
  const migracion_facturas = mig.ok;

  const tk = await tokenXubio();
  const mapa = await mapaApi().catch((e) => ({ error: String(e) }));
  if (!tk.ok) return responder(200, { ok: false, paso: "token", migracion_facturas, token: tk, mapa });

  const compras = await getXubio(tk.token!, "/comprobanteCompraBean");
  const lista = Array.isArray(compras.cuerpo) ? compras.cuerpo : [];
  const proveedores = await getXubio(tk.token!, "/ProveedorBean");
  const listaProv = Array.isArray(proveedores.cuerpo) ? proveedores.cuerpo : [];

  return responder(200, {
    ok: true,
    migracion_facturas,
    mapa,
    compras: { status: compras.status, headers: compras.headers, cantidad_pagina: lista.length, ejemplo: lista[0] ?? compras.cuerpo },
    proveedores: { status: proveedores.status, cantidad_pagina: listaProv.length, ejemplo: listaProv[0] ?? proveedores.cuerpo },
  });
});
