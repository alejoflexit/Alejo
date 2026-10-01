// admin-usuarios
// Centro de control de usuarios de la app (solo admin).
// Crear usuarios, cambiar contraseñas, desactivar accesos y editar qué secciones ve cada uno.
//
// Todo lo que toca auth.users necesita la service role key, que NUNCA puede ir en el front
// (el repo es público y la clave viajaría en el bundle). Por eso vive acá: el front manda su
// JWT, esta función verifica que sea un admin (usuarios_permisos.rol = 'admin') y recién ahí
// opera con la service role. Cada cambio queda anotado en usuarios_admin_log.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const SECCIONES = ["metricas", "colectas", "arribos", "zonas", "pizarra", "tiquetera", "pendientes", "choferes", "pagos"];
// Liquidaciones: las tablas de pagos tienen RLS fija a admin@flexit.app. Dar el permiso a otro
// usuario mostraría una pantalla vacía, así que no se ofrece (el rótulo no puede prometer algo
// que el sistema no hace).
const SOLO_ADMIN = ["pagos"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (estado: number, cuerpo: Record<string, unknown>) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });

const svc = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

async function leerJson(r: Response) {
  try { return await r.json(); } catch { return {}; }
}

function limpiarSecciones(s: unknown): string[] {
  if (!Array.isArray(s)) return [];
  return [...new Set(s.map(String))].filter((x) => SECCIONES.includes(x) && !SOLO_ADMIN.includes(x));
}

async function log(quien: string, accion: string, objetivo: string, detalle: Record<string, unknown> = {}) {
  await svc("/rest/v1/usuarios_admin_log", {
    method: "POST",
    body: JSON.stringify({ quien, accion, objetivo, detalle }),
  }).catch(() => {});
}

async function upsertPermisos(fila: Record<string, unknown>) {
  const r = await svc("/rest/v1/usuarios_permisos?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ ...fila, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error("No se pudieron guardar los permisos");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder(405, { ok: false, error: "Método no permitido" });

  // 1) ¿Quién llama?
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return responder(401, { ok: false, error: "Sin sesión" });
  const ru = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON } });
  if (!ru.ok) return responder(401, { ok: false, error: "Sesión vencida" });
  const yo = await ru.json();

  // 2) ¿Es admin?
  const rp = await svc(`/rest/v1/usuarios_permisos?select=rol&user_id=eq.${yo.id}`);
  const filaYo = (await leerJson(rp))?.[0];
  if (!filaYo || filaYo.rol !== "admin") return responder(403, { ok: false, error: "Solo un administrador puede usar esto" });
  const quien = yo.email as string;

  const body = await leerJson(req);
  const accion = String(body.accion || "");

  try {
    // ── LISTAR ──
    if (accion === "listar") {
      const [ra, rperm] = await Promise.all([
        svc("/auth/v1/admin/users?per_page=500"),
        svc("/rest/v1/usuarios_permisos?select=*"),
      ]);
      const a = await leerJson(ra);
      const perms: Record<string, any> = {};
      for (const p of (await leerJson(rperm)) || []) perms[p.user_id] = p;
      const usuarios = (a.users || []).map((u: any) => {
        const p = perms[u.id];
        return {
          id: u.id,
          email: u.email,
          nombre: p?.nombre || u.user_metadata?.nombre || null,
          rol: p?.rol || "usuario",
          secciones: p?.secciones || null, // null = nunca configurado (ve lo de siempre)
          creado: u.created_at,
          ultimo_ingreso: u.last_sign_in_at,
          desactivado: !!(u.banned_until && Date.parse(u.banned_until) > Date.now()),
          es_yo: u.id === yo.id,
        };
      }).sort((x: any, y: any) => (x.rol === "admin" ? -1 : y.rol === "admin" ? 1 : String(x.email).localeCompare(String(y.email))));
      return responder(200, { ok: true, usuarios, secciones: SECCIONES, solo_admin: SOLO_ADMIN });
    }

    // ── CREAR ──
    if (accion === "crear") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const nombre = String(body.nombre || "").trim() || null;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responder(400, { ok: false, error: "Email inválido" });
      if (password.length < 8) return responder(400, { ok: false, error: "La contraseña tiene que tener al menos 8 caracteres" });
      const rc = await svc("/auth/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: nombre ? { nombre } : {} }),
      });
      const c = await leerJson(rc);
      if (!rc.ok) {
        const msg = String(c.msg || c.message || c.error_description || "");
        return responder(400, { ok: false, error: /already|registered|exists/i.test(msg) ? "Ya existe un usuario con ese email" : (msg || "No se pudo crear") });
      }
      const secciones = limpiarSecciones(body.secciones);
      await upsertPermisos({ user_id: c.id, email, nombre, rol: "usuario", secciones, updated_by: quien });
      await log(quien, "crear", email, { secciones });
      return responder(200, { ok: true, id: c.id });
    }

    // A partir de acá todo opera sobre un usuario existente
    const id = String(body.id || "");
    if (!/^[0-9a-f-]{36}$/.test(id)) return responder(400, { ok: false, error: "Usuario inválido" });
    const rget = await svc(`/auth/v1/admin/users/${id}`);
    if (!rget.ok) return responder(404, { ok: false, error: "No existe ese usuario" });
    const objetivo = await rget.json();
    const rpo = await svc(`/rest/v1/usuarios_permisos?select=*&user_id=eq.${id}`);
    const permObj = (await leerJson(rpo))?.[0];

    // ── PERMISOS / NOMBRE ──
    if (accion === "permisos") {
      if (permObj?.rol === "admin") return responder(400, { ok: false, error: "El administrador ve todo; no se le recortan secciones" });
      const secciones = limpiarSecciones(body.secciones);
      const nombre = body.nombre !== undefined ? (String(body.nombre).trim() || null) : (permObj?.nombre ?? null);
      await upsertPermisos({ user_id: id, email: objetivo.email, nombre, rol: permObj?.rol || "usuario", secciones, updated_by: quien });
      if (body.nombre !== undefined) {
        await svc(`/auth/v1/admin/users/${id}`, {
          method: "PUT",
          body: JSON.stringify({ user_metadata: { ...(objetivo.user_metadata || {}), nombre } }),
        });
      }
      await log(quien, "permisos", objetivo.email, { antes: permObj?.secciones ?? null, despues: secciones, nombre });
      return responder(200, { ok: true });
    }

    // ── CONTRASEÑA ──
    if (accion === "password") {
      const password = String(body.password || "");
      if (password.length < 8) return responder(400, { ok: false, error: "La contraseña tiene que tener al menos 8 caracteres" });
      const r = await svc(`/auth/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ password }) });
      if (!r.ok) { const e = await leerJson(r); return responder(400, { ok: false, error: e.msg || e.message || "No se pudo cambiar" }); }
      await log(quien, "password", objetivo.email);
      return responder(200, { ok: true });
    }

    // ── ACTIVAR / DESACTIVAR ──
    if (accion === "desactivar" || accion === "activar") {
      if (id === yo.id) return responder(400, { ok: false, error: "No te podés desactivar a vos mismo" });
      const ban_duration = accion === "desactivar" ? "876000h" : "none";
      const r = await svc(`/auth/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ ban_duration }) });
      if (!r.ok) { const e = await leerJson(r); return responder(400, { ok: false, error: e.msg || e.message || "No se pudo actualizar" }); }
      await log(quien, accion, objetivo.email);
      return responder(200, { ok: true });
    }

    return responder(400, { ok: false, error: "Acción desconocida" });
  } catch (e) {
    return responder(500, { ok: false, error: (e as Error).message || "Error interno" });
  }
});
