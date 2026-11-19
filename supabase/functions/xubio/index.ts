// xubio
// (deploy: 2026-11-19)
// Puente entre la app y la API de Xubio (etapa 2 de facturas por link — ver ESTADO-FACTURAS-LINK.md).
// Las credenciales viven SOLO acá como secretos de la función: XUBIO_CLIENT_ID / XUBIO_SECRET_ID
// (Supabase › Edge Functions › Secrets). Nunca van al front: el repo es público.
//
// Acciones (POST {accion}):
//   probar  → saca un token, mira qué expone la API para compras/proveedores y trae 1 comprobante
//             de compra de ejemplo para copiar exactamente cómo los carga Adrián. No escribe nada.
//   cargar  → {cierre_id}: carga en Xubio las facturas que el cadete subió por su link (botón
//             "Cargar en Xubio" de Pagar). Copia el molde de Adrián (19/11): producto "Costo envios",
//             descripción "Envios", sin IVA, número C-PPPPP-NNNNNNNN, proveedor = el cadete por CUIT.
//             No crea proveedores ni carga notas de débito/crédito (eso sigue a mano). Si el mismo
//             número ya está en Xubio para ese proveedor, no lo duplica: lo marca como cargado.
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


// ── cargar ────────────────────────────────────────────────────────────────
const PRODUCTO_ENVIOS = 1853000;   // "Costo envios" (lo que usa Adrián)
const soloDigitos = (x: unknown) => String(x ?? "").replace(/\D/g, "");

async function cargarCierre(token: string, cierreId: string, quien: string) {
  const rc = await svc(`/rest/v1/pagos_cierres?select=id,cadete,semana_label,factura_ok,pagado,total&id=eq.${encodeURIComponent(cierreId)}`);
  const cierre = (await leer(rc))?.[0];
  if (!cierre) return { ok: false, error: "No encontré esa liquidación" };
  if (!cierre.factura_ok) return { ok: false, error: "La factura todavía no está OK" };

  const rcomp = await svc(`/rest/v1/facturas_comprobantes?select=*&cierre_id=eq.${cierre.id}&borrado_at=is.null&order=created_at`);
  const comps = (await leer(rcomp)) || [];
  if (!Array.isArray(comps) || !comps.length) return { ok: false, error: "Esta factura no vino por el link: cargala a mano en Xubio" };
  const pendientes = comps.filter((c: any) => !c.xubio_id);
  if (!pendientes.length) return { ok: true, resultados: [], yaCargado: true };

  // CUIT del cadete: el del PDF, o el de Config
  const rt = await svc(`/rest/v1/cadetes_tarifas?select=cuil,nombre,nombre_lightdata`);
  const tarifas = (await leer(rt)) || [];
  const norm = (x: string) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
  const tarifa = tarifas.find((t: any) => norm(t.nombre_lightdata) === norm(cierre.cadete)) || {};

  const provs = await getXubio(token, "/ProveedorBean");
  const listaProv = Array.isArray(provs.cuerpo) ? provs.cuerpo : [];
  const compras = await getXubio(token, "/comprobanteCompraBean");
  const listaCompras = Array.isArray(compras.cuerpo) ? compras.cuerpo : [];

  const resultados: any[] = [];
  for (const c of pendientes) {
    const r: any = { id: c.id, tipo: c.tipo };
    resultados.push(r);
    if (c.tipo !== "factura") { r.error = "Las notas de débito/crédito se cargan a mano por ahora"; continue; }
    if (!c.letra || !c.punto_venta || !c.numero || !c.monto) { r.error = "No pude leer letra/punto de venta/número/importe del PDF: cargala a mano"; continue; }
    const cuit = soloDigitos(c.cuit) || soloDigitos(tarifa.cuil);
    if (cuit.length !== 11) { r.error = "Falta el CUIT del cadete (cargalo en Config)"; continue; }
    const prov = listaProv.find((p: any) => soloDigitos(p.cuit) === cuit);
    if (!prov) { r.error = `El CUIT ${cuit} no está como proveedor en Xubio: crealo una vez y volvé a tocar`; continue; }
    const provId = prov.proveedorid ?? prov.id ?? prov.ID;
    const doc = `${c.letra}-${c.punto_venta}-${c.numero}`;
    r.documento = doc; r.proveedor = prov.nombre;

    const ya = listaCompras.find((x: any) => x.numeroDocumento === doc && Number(x.proveedor?.ID ?? x.proveedor?.id) === Number(provId));
    let transaccion = ya?.transaccionid;
    if (!transaccion) {
      const fecha = c.fecha_emision || String(c.created_at).slice(0, 10);
      const total = Number(c.monto);
      const body = {
        circuitoContable: { ID: -2 }, tipo: 1, proveedor: { ID: provId },
        numeroDocumento: doc, puntoVenta: c.punto_venta,
        fecha, fechaComprobante: fecha, fechaFiscal: fecha, fechaVto: fecha,
        moneda: { ID: -2 }, cotizacion: 1, cotizacionListaDePrecio: 1, deposito: { ID: -2 }, condicionDePago: 1,
        descripcion: "Envios", externalId: `flexit-fc-${c.id}`,
        importeGravado: total, importeImpuestos: 0, importetotal: total, importeMonPrincipal: total,
        transaccionProductoItems: [{
          producto: { ID: PRODUCTO_ENVIOS }, deposito: { ID: -2 }, descripcion: "Envios",
          cantidad: 1, precio: total, importe: total, total, iva: 0, montoExento: 0, porcentajeDescuento: 0, precioconivaincluido: 0,
        }],
        transaccionPercepcionItems: [], transaccionOrdenPagoItems: [],
      };
      const rp = await fetch(`${XUBIO}/comprobanteCompraBean`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const jp = await leer(rp);
      if (!rp.ok || !jp?.transaccionid) { r.error = `Xubio rechazó la carga (${rp.status})`; r.detalle = jp; continue; }
      transaccion = jp.transaccionid;
    } else {
      r.yaEstaba = true;
    }
    await svc(`/rest/v1/facturas_comprobantes?id=eq.${c.id}`, {
      method: "PATCH", body: JSON.stringify({ xubio_id: transaccion, xubio_at: new Date().toISOString(), xubio_por: quien }),
    });
    r.ok = true; r.xubio_id = transaccion;
  }
  return { ok: resultados.every((r) => r.ok), resultados };
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

  const { accion, cierre_id } = await req.json().catch(() => ({}));
  if (accion === "cargar") {
    if (!cierre_id) return responder(400, { ok: false, error: "Falta cierre_id" });
    const tk = await tokenXubio();
    if (!tk.ok) return responder(200, { ok: false, error: "No pude conectar con Xubio", detalle: tk });
    return responder(200, await cargarCierre(tk.token!, String(cierre_id), String(yo.email || "")));
  }
  if (accion !== "probar") return responder(400, { ok: false, error: "Acción desconocida" });

  // ¿Se corrió la migración de facturas por link?
  const mig = await svc(`/rest/v1/facturas_comprobantes?select=id&limit=1`);
  const migracion_facturas = mig.ok;

  const tk = await tokenXubio();
  const mapa = await mapaApi().catch((e) => ({ error: String(e) }));
  if (!tk.ok) return responder(200, { ok: false, paso: "token", migracion_facturas, token: tk, mapa });

  const compras = await getXubio(tk.token!, "/comprobanteCompraBean");
  const lista = Array.isArray(compras.cuerpo) ? compras.cuerpo : [];
  // Detalle completo del último comprobante (ítems, cuenta, tipo): el molde para cargar los nuevos.
  const ultimo = lista.length ? [...lista].sort((a: any, b: any) => String(b.fecha).localeCompare(String(a.fecha)))[0] : null;
  const detalle = ultimo?.transaccionid ? await getXubio(tk.token!, `/comprobanteCompraBean/${ultimo.transaccionid}`) : null;
  const proveedores = await getXubio(tk.token!, "/ProveedorBean");
  const listaProv = Array.isArray(proveedores.cuerpo) ? proveedores.cuerpo : [];

  return responder(200, {
    ok: true,
    migracion_facturas,
    mapa,
    compras: { status: compras.status, headers: compras.headers, cantidad_pagina: lista.length, ejemplo: lista[0] ?? compras.cuerpo, detalle_ultimo: detalle?.cuerpo },
    proveedores: { status: proveedores.status, cantidad_pagina: listaProv.length, ejemplo: listaProv[0] ?? proveedores.cuerpo,
      proveedor_del_ultimo: ultimo?.proveedor?.ID ? (await getXubio(tk.token!, `/ProveedorBean/${ultimo.proveedor.ID}`)).cuerpo : null },
  });
});
