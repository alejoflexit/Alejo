import { estadoCadete, proyeccion, huecosDelDia, saludDatos, armarCadetes, resumen, hhmm, hace } from "./monitoreoShared";

const cad = (o) => ({ t: 30, e: 0, pend: 30, camino: 0, planta: 0, cancel: 0, otros: 0, salida: null, primeraEnt: null, ultimaEnt: null, ultimoMov: null, entH: {}, ...o });
const H = (h, m = 0) => h * 60 + m;

test("formatos", () => {
  expect(hhmm(H(9, 5))).toBe("09:05");
  expect(hhmm(null)).toBe("—");
  expect(hace(7)).toBe("hace 7'");
  expect(hace(75)).toBe("hace 1 h 15'");
});

test("todo en planta = no salió", () => {
  expect(estadoCadete(cad({ planta: 30 }), H(17)).clave).toBe("no_salio");
});

test("salió hace poco sin entregas = arrancando; hace más de una hora = sin entregas", () => {
  expect(estadoCadete(cad({ camino: 30, salida: H(16, 30) }), H(17)).clave).toBe("sin_entregas");
  expect(estadoCadete(cad({ camino: 30, salida: H(16, 30) }), H(17)).atencion).toBe(false);
  expect(estadoCadete(cad({ camino: 30, salida: H(15, 30) }), H(17)).atencion).toBe(true);
});

test("frenado: pendientes y última entrega hace 60' o más", () => {
  const c = cad({ e: 10, pend: 20, camino: 20, salida: H(14), primeraEnt: H(14, 30), ultimaEnt: H(16) });
  expect(estadoCadete(c, H(17, 5)).clave).toBe("frenado");
  expect(estadoCadete(c, H(16, 30)).clave).not.toBe("frenado");
});

test("terminó cuando no le quedan pendientes", () => {
  expect(estadoCadete(cad({ e: 28, pend: 0, cancel: 2, salida: H(14) }), H(19)).clave).toBe("termino");
});

test("sin nada encima (solo Nadie/reprogramados) cuenta como terminado, no frenado", () => {
  const c = cad({ e: 20, pend: 5, otros: 5, salida: H(16), primeraEnt: H(16, 30), ultimaEnt: H(20, 16) });
  const st = estadoCadete(c, H(22, 4));
  expect(st.clave).toBe("termino");
  expect(st.label).toBe("Terminó · 5 sin entregar");
});

test("proyección: ritmo y fin estimado; termina tarde si pasa las 21", () => {
  // 10 entregas en 2 h = 5/h; quedan 25 → 5 h más desde las 16 = 21:00 justo
  const c = cad({ e: 10, pend: 25, camino: 25, salida: H(13, 50), primeraEnt: H(14), ultimaEnt: H(16) });
  expect(proyeccion(c, H(16))).toEqual({ ritmo: 5, fin: H(21) });
  const c2 = { ...c, pend: 30, camino: 30 };
  expect(estadoCadete(c2, H(16)).clave).toBe("tarde");
  expect(proyeccion(cad({ e: 2, primeraEnt: H(14), ultimaEnt: H(15) }), H(15))).toBeNull();
});

test("ordena lo urgente arriba", () => {
  const lista = armarCadetes({
    Ok: cad({ e: 30, pend: 0, salida: H(14) }),
    Planta: cad({ planta: 30 }),
    Ruta: cad({ e: 10, pend: 5, camino: 5, salida: H(14), primeraEnt: H(14, 10), ultimaEnt: H(16, 50) }),
  }, H(17));
  expect(lista.map((c) => c.nombre)).toEqual(["Planta", "Ruta", "Ok"]);
  const r = resumen(lista, { sinAsignar: { t: 3 }, internos: { "Repro gramar": 4 } });
  expect(r).toMatchObject({ noSalio: 1, termino: 1, enRuta: 1, sinAsignar: 3, internos: 4, atencion: 1 });
});

test("huecos: detecta una hora sin movimientos en pleno reparto, ignora la mañana", () => {
  const act = {}, ent = {};
  for (let b = H(14); b < H(20); b += 15) { act[b] = 30; ent[b] = 25; }
  for (let b = H(15, 15); b < H(16, 15); b += 15) { delete act[b]; delete ent[b]; } // 15:15–16:15 vacío
  act[H(9)] = 1; ent[H(9)] = 1; // una entrega suelta a la mañana, después nada hasta las 14
  expect(huecosDelDia(act, ent, 2000, H(20))).toEqual([{ desde: H(15, 15), hasta: H(16, 15) }]);
  // 30' sin datos no alcanza para marcar hueco
  const act2 = { ...act }; for (let b = H(15, 15); b < H(16, 15); b += 15) act2[b] = 5; delete act2[H(17)]; delete act2[H(17, 15)];
  expect(huecosDelDia(act2, ent, 2000, H(20))).toEqual([]);
});

test("salud: caída si hay gente en la calle y 45' sin movimientos en horario", () => {
  const d = { conHora: true, total: 1500, ultimoEvento: H(18), actividad: {}, entregas: {}, porCadete: { A: cad({ camino: 12 }) } };
  expect(saludDatos(d, H(18, 50)).nivel).toBe("crit");
  expect(saludDatos(d, H(18, 30)).nivel).toBe("warn");
  expect(saludDatos(d, H(18, 10)).nivel).toBe("ok");
  // de noche o sin nadie en la calle no alarma
  expect(saludDatos({ ...d, ultimoEvento: H(22, 50) }, H(23, 40)).nivel).toBe("ok");
  expect(saludDatos({ ...d, porCadete: { A: cad({ camino: 0, pend: 0 }) } }, H(18, 50)).nivel).toBe("ok");
});
