// refrescar-envios
// El boton "Actualizar" de Pendientes historicos releia Supabase pero no pedia
// datos nuevos a LightData: el rotulo prometia algo que el sistema no hacia.
// Esta funcion dispara la corrida real (el workflow de GitHub Actions que baja
// de LightData y escribe envios_busqueda).
//
// El token de GitHub vive como secreto de la funcion, nunca en el front: el repo
// es publico y cualquiera podria leerlo del bundle.
//
// Frena pedidos seguidos: si la ultima sincronizacion tiene menos de MIN_MINUTOS,
// no dispara nada. Son ~15 personas tocando el boton y no hay razon para pegarle
// a LightData cada treinta segundos.

const GITHUB_TOKEN = Deno.env.get("GITHUB_DISPATCH_TOKEN") ?? "";
const REPO = Deno.env.get("GITHUB_REPO") ?? "alejoflexit/Alejo";
const WORKFLOW = Deno.env.get("GITHUB_WORKFLOW") ?? "envios_agente.yml";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const MIN_MINUTOS = Number(Deno.env.get("MIN_MINUTOS") ?? 5);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const responder = (estado: number, cuerpo: Record<string, unknown>) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return responder(401, { ok: false, motivo: "sin_sesion" });

  // Solo alguien con sesion del equipo puede disparar la corrida.
  const usuario = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: ANON },
  });
  if (!usuario.ok) return responder(401, { ok: false, motivo: "sin_sesion" });

  // Cuando se sincronizo por ultima vez, segun los datos mismos.
  let ultima: string | null = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/envios_busqueda?select=actualizado_at&order=actualizado_at.desc&limit=1`,
      { headers: { Authorization: auth, apikey: ANON } },
    );
    const filas = await r.json();
    ultima = Array.isArray(filas) && filas[0] ? filas[0].actualizado_at : null;
  } catch { /* si no se puede leer, se deja pasar: el freno es una cortesia, no un candado */ }

  if (ultima) {
    const minutos = (Date.now() - Date.parse(ultima)) / 60000;
    if (Number.isFinite(minutos) && minutos < MIN_MINUTOS) {
      return responder(200, { ok: false, motivo: "reciente", ultima, minutos: Math.round(minutos) });
    }
  }

  if (!GITHUB_TOKEN) return responder(200, { ok: false, motivo: "sin_token", ultima });

  const disparo = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );
  if (disparo.status !== 204) {
    const detalle = (await disparo.text()).slice(0, 200);
    return responder(200, { ok: false, motivo: "github", status: disparo.status, detalle, ultima });
  }

  return responder(200, { ok: true, ultima });
});
