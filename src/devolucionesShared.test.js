import { armarCaso, resumen, codigoDeQR, agruparParaRemitos, QR_PREFIJO, reclamosPorCadete, mensajeReclamo } from "./devolucionesShared";

const AHORA = Date.parse("2026-10-20T12:00:00-03:00");
const base = { did: 1, cliente: "Ohpic", valor: 1000, fecha_alta: "2026-10-01T10:00:00-03:00" };

test("cancelado sin chofer depósito está en la calle y cuenta desde la cancelación", () => {
  const c = armarCaso({ ...base, tipo: "CANCELADO", estado_ld: 8, fecha_cancelado: "2026-10-10T10:00:00-03:00" }, {}, AHORA);
  expect(c.etapa).toBe("calle");
  expect(c.dias).toBe(10);
  expect(c.vencido).toBe(true);
});

test("cancelado con chofer devuelto deposito está en depósito y cuenta desde el ingreso", () => {
  const c = armarCaso({ ...base, tipo: "CANCELADO", estado_ld: 8, en_deposito_ld: true, fecha_deposito: "2026-10-15T10:00:00-03:00" }, {}, AHORA);
  expect(c.etapa).toBe("deposito");
  expect(c.dias).toBe(5);
  expect(c.vencido).toBe(false);
});

test("estado 14 es devuelto aunque tenga chofer depósito", () => {
  expect(armarCaso({ ...base, tipo: "CANCELADO", estado_ld: 14, en_deposito_ld: true }, {}, AHORA).etapa).toBe("devuelto");
});

test("cambio: sin retirar → retiro; retirado → calle; ingreso marcado → depósito", () => {
  const d = { ...base, tipo: "CAMBIO", estado_ld: 7 };
  expect(armarCaso(d, {}, AHORA).etapa).toBe("retiro");
  expect(armarCaso({ ...d, estado_ld: 5, fecha_retiro: "2026-10-18T10:00:00-03:00" }, {}, AHORA).etapa).toBe("calle");
  const dep = armarCaso({ ...d, estado_ld: 5 }, { ingreso_deposito_at: "2026-10-19T10:00:00-03:00" }, AHORA);
  expect(dep.etapa).toBe("deposito");
  expect(dep.dias).toBe(1);
});

test("extraviado y descartado no cuentan en los totales; reclamado sí", () => {
  const d = { ...base, tipo: "CANCELADO", estado_ld: 8 };
  const casos = [armarCaso(d, { marca: "extraviado" }, AHORA), armarCaso(d, { marca: "reclamado" }, AHORA), armarCaso(d, {}, AHORA)];
  const r = resumen(casos);
  expect(r.calle).toBe(2);
  expect(r.marcados).toBe(2);
});

test("NO_ES saca el caso", () => {
  expect(armarCaso({ ...base, tipo: "CAMBIO", estado_ld: 5 }, { tipo_override: "NO_ES" }, AHORA)).toBeNull();
});

test("reclamos: agrupa por cadete, saca choferes ficticios y arma el mensaje", () => {
  const d = { ...base, tipo: "CANCELADO", estado_ld: 8, fecha_cancelado: "2026-10-10T10:00:00-03:00", direccion: "Bustamante 1987", localidad: "Hurlingham", ml_venta_id: "2000" };
  const casos = [armarCaso({ ...d, cadete: "Juan Perez" }, {}, AHORA), armarCaso({ ...d, cadete: "Juan Perez" }, {}, AHORA), armarCaso({ ...d, cadete: "Repro gramar" }, {}, AHORA)];
  const g = reclamosPorCadete(casos);
  expect(g.map((x) => [x.cadete, x.casos.length])).toEqual([["Juan Perez", 2], ["", 1]]);
  const m = mensajeReclamo("Juan Perez", g[0].casos);
  expect(m.startsWith("Hola Juan 👋")).toBe(true);
  expect(m.includes("Tenés *2 paquetes*")).toBe(true);
  expect(m.includes("🔴 *Atrasados")).toBe(true);
  expect(m.includes("Bustamante 1987, Hurlingham")).toBe(true);
});

test("QR: lee el código y rechaza otra cosa", () => {
  expect(codigoDeQR(QR_PREFIJO + "RD-00012")).toBe("RD-00012");
  expect(codigoDeQR("https://mercadolibre.com/123")).toBeNull();
});

test("remitos: uno por cliente, de a 25", () => {
  const casos = Array.from({ length: 30 }, (_, i) => ({ did: i, cliente: i < 27 ? "A" : "B" }));
  const g = agruparParaRemitos(casos);
  expect(g.map((x) => [x.cliente, x.casos.length])).toEqual([["A", 25], ["A", 2], ["B", 3]]);
});

test("progreso: meta del día, quién trajo y racha", () => {
  const { progresoDelDia, metaCumplida, quienTrajo, racha, metaDevolver } = require("./devolucionesShared");
  const hoy = "2026-10-20T15:00:00-03:00";
  const casos = [
    armarCaso({ ...base, tipo: "CANCELADO", estado_ld: 8, cadete: "Juan", fecha_cancelado: "2026-10-01T10:00:00-03:00" }, { reclamo_at: hoy }, AHORA),
    armarCaso({ ...base, tipo: "CANCELADO", estado_ld: 8, cadete: "Ana", fecha_cancelado: "2026-10-01T10:00:00-03:00" }, {}, AHORA),
    armarCaso({ ...base, tipo: "CANCELADO", estado_ld: 14, fecha_devuelto_cliente: hoy, valor: 500, cadete_previo: "Juan" }, {}, AHORA),
  ];
  const p = progresoDelDia(casos, AHORA);
  expect([p.cadetesAReclamar, p.cadetesReclamados, p.devueltos]).toEqual([2, 1, 1]);
  expect(metaCumplida(p, 1)).toBe(false);
  expect(quienTrajo(casos[2])).toBe("Juan");
  expect(metaDevolver(536)).toBe(18);
  // 20/10/2026 es martes: lunes 19 cumplido, domingo 18 se saltea, sábado 17 cumplido, viernes 16 no
  const diario = [{ fecha: "2026-10-19", cumplida: true }, { fecha: "2026-10-17", cumplida: true }, { fecha: "2026-10-16", cumplida: false }];
  expect(racha(diario, false, AHORA)).toBe(2);
  expect(racha(diario, true, AHORA)).toBe(3);
});

test("cancelado en la calle marcado 'Ingresó a depósito' en la app pasa a depósito", () => {
  const { quienTrajo } = require("./devolucionesShared");
  const c = armarCaso({ ...base, tipo: "CANCELADO", estado_ld: 8, cadete: "Juan", fecha_cancelado: "2026-10-01T10:00:00-03:00" }, { ingreso_deposito_at: "2026-10-19T10:00:00-03:00" }, AHORA);
  expect(c.etapa).toBe("deposito");
  expect(c.dias).toBe(1);
  expect(quienTrajo(c)).toBe("Juan");
});

test("calidad: detecta foto lisa (borrosa) y oscura; una con bordes pasa", () => {
  const { calidadDeImagen } = require("./devolucionesShared");
  const w = 40, h = 40;
  const lisa = new Array(w * h).fill(30);
  expect(calidadDeImagen(lisa, w, h).problemas).toEqual(["oscura", "borrosa"]);
  const tablero = Array.from({ length: w * h }, (_, i) => (((i % w) >> 2) + ((i / w | 0) >> 2)) % 2 ? 230 : 40);
  expect(calidadDeImagen(tablero, w, h).problemas).toEqual([]);
});

test("búsqueda: varias palabras, sin tildes, y 'al 200' = 200–299", () => {
  const { coincideBusqueda } = require("./devolucionesShared");
  const c = { cliente: "Ohpic", cadete: "Yamila Segovia", direccion: "Aráoz 245", localidad: "Palermo", did: 99 };
  expect(coincideBusqueda(c, "yamila araoz 200")).toBe(true);
  expect(coincideBusqueda(c, "Yamila al 200")).toBe(true);
  expect(coincideBusqueda(c, "yamila 300")).toBe(false);
  expect(coincideBusqueda(c, "kevin araoz")).toBe(false);
  expect(coincideBusqueda(c, "palermo ohpic")).toBe(true);
});

test("etiqueta: QR de ML, código de barras, QR de LightData y tipeado", () => {
  const { casoDeEtiqueta } = require("./devolucionesShared");
  const casos = [{ did: 973846, tracking: "47963506158", ml_venta_id: "2000018349428094" }, { did: 1015902, tracking: "B5060" }];
  expect(casoDeEtiqueta(casos, '{"id":"47963506158","sender_id":123,"hash_code":"x"}').did).toBe(973846);
  expect(casoDeEtiqueta(casos, "47963506158").did).toBe(973846);
  expect(casoDeEtiqueta(casos, '{"local":1,"did":"1015902","cliente":5}').did).toBe(1015902);
  expect(casoDeEtiqueta(casos, "b5060").did).toBe(1015902);
  expect(casoDeEtiqueta(casos, "#1015902").did).toBe(1015902);
  expect(casoDeEtiqueta(casos, "999999999")).toBeNull();
});

test("listos para devolver: solo depósito sin remito, por seller, el más viejo primero", () => {
  const { listosParaDevolver } = require("./devolucionesShared");
  const casos = [
    { did: 1, cliente: "A", etapa: "deposito", dias: 3 }, { did: 2, cliente: "B", etapa: "deposito", dias: 20, vencido: true },
    { did: 3, cliente: "A", etapa: "deposito", dias: 9 }, { did: 4, cliente: "B", etapa: "deposito", dias: 1 },
    { did: 5, cliente: "C", etapa: "calle", dias: 30 }, { did: 6, cliente: "C", etapa: "deposito", dias: 50 },
  ];
  const g = listosParaDevolver(casos, new Set([6]));
  expect(g.map((x) => [x.cliente, x.casos.map((c) => c.did)])).toEqual([["B", [2, 4]], ["A", [3, 1]]]);
  expect(g[0].vencidos).toBe(1);
});

test("ubicación: lugar propio o caja por letra", () => {
  const { ubicacionDe } = require("./devolucionesShared");
  expect(ubicacionDe("Ohpic", { Ohpic: "B3" })).toEqual({ codigo: "B3", propia: true });
  expect(ubicacionDe("iamiqué").codigo).toBe("Caja G-I");
  expect(ubicacionDe("Électro").codigo).toBe("Caja D-F");
  expect(ubicacionDe("3D Store").codigo).toBe("Caja 0-9");
  expect(ubicacionDe("Zeta").codigo).toBe("Caja V-Z");
});
