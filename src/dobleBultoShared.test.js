import { leerEtiqueta, envioCoincide, filtroEnvios, textoParaExcel, desdeRango, hastaRango, estadoFila, fechaCorta, resumen, diasDelRango, diaAR } from "./dobleBultoShared";

test("lee el QR de Mercado Libre", () => {
  const r = leerEtiqueta('{"id":"45123456789","t":"lm","sender_id":123456789,"hash_code":"abc","security_digit":"0"}');
  expect(r).toMatchObject({ codigo: "45123456789", sender_id: "123456789", tipo: "ml" });
});

test("lee el QR propio de LightData", () => {
  expect(leerEtiqueta('{"did":1088519}')).toMatchObject({ codigo: "1088519", sender_id: null, tipo: "ld" });
});

test("acepta texto tipeado y descarta basura", () => {
  expect(leerEtiqueta("#2000019256677600").codigo).toBe("2000019256677600");
  expect(leerEtiqueta("9d48064b-76a8-47ec-94ea-c057de3c").codigo).toBe("9d48064b-76a8-47ec-94ea-c057de3c");
  expect(leerEtiqueta("")).toBeNull();
  expect(leerEtiqueta("ab")).toBeNull();
  expect(leerEtiqueta("https://algo.com/una url con espacios")).toBeNull();
  expect(leerEtiqueta('{"otra":"cosa"}')).toBeNull();
});

test("cruza por tracking, id interno o venta", () => {
  expect(envioCoincide({ tracking: "45123456789" }, "45123456789")).toBe(true);
  expect(envioCoincide({ id_interno: "1088519" }, "1088519")).toBe(true);
  expect(envioCoincide({ id_venta_ml: "#2000019256677600" }, "2000019256677600")).toBe(true);
  expect(envioCoincide({ tracking: "1" }, "2")).toBe(false);
});

test("arma el filtro sin códigos raros", () => {
  expect(filtroEnvios(["45123456789", "a b", "45123456789"])).toBe('or=(tracking.in.("45123456789"),id_interno.in.("45123456789"),id_venta_ml.in.("45123456789"))');
  expect(filtroEnvios(["a,b)"])).toBeNull();
});

test("texto para Excel en el orden de la planilla, del más viejo al más nuevo", () => {
  const filas = [
    { escaneado_at: "2026-11-02T15:00:00Z", cliente: "La Plata Trade", codigo: "48394964793", direccion: "Calle Tucuman 2986", bultos: 2, localidad: "Bella Vista" },
    { escaneado_at: "2026-11-02T13:00:00Z", cliente: "Unistore", codigo: "x123", direccion: "Rosario\t619", bultos: 6, localidad: "Caballito" },
  ];
  expect(textoParaExcel(filas)).toBe("02/11\tUnistore\tx123\tRosario 619\t6\tCaballito\n02/11\tLa Plata Trade\t48394964793\tCalle Tucuman 2986\t2\tBella Vista");
});

test("la fecha es la de Argentina", () => {
  expect(fechaCorta("2026-11-03T02:30:00Z")).toBe("02/11"); // 23:30 del 02 en AR
});

test("rangos: semana arranca el lunes", () => {
  const dom = Date.parse("2026-11-08T22:00:00Z"); // domingo 19:00 AR
  expect(desdeRango("hoy", dom)).toBe("2026-11-08T03:00:00.000Z");
  expect(desdeRango("semana", dom)).toBe("2026-11-02T03:00:00.000Z");
  expect(desdeRango("pasada", dom)).toBe("2026-10-26T03:00:00.000Z");
  expect(hastaRango("pasada", dom)).toBe("2026-11-02T03:00:00.000Z");
  expect(hastaRango("semana", dom)).toBeNull();
});

test("estado y resumen", () => {
  const ahora = Date.parse("2026-11-08T22:00:00Z");
  const ok = { escaneado_at: "2026-11-08T12:00:00Z", cruzado_at: "x", bultos: 2 };
  const pend = { escaneado_at: "2026-11-08T12:00:00Z", bultos: 3 };
  const viejo = { escaneado_at: "2026-11-01T12:00:00Z", bultos: 2 };
  expect(estadoFila(ok, ahora)).toBe("ok");
  expect(estadoFila(pend, ahora)).toBe("pendiente");
  expect(estadoFila(viejo, ahora)).toBe("no_aparece");
  expect(resumen([ok, pend, viejo], ahora)).toEqual({ paquetes: 3, bultos: 7, sinDatos: 2 });
});

test("días del rango semanal para los chips (reloj AR)", () => {
  const martes = Date.parse("2026-11-10T22:00:00Z"); // martes 10/11 19:00 AR
  expect(diasDelRango("semana", martes).map((d) => d.label)).toEqual(["Lun 9", "Mar 10"]);
  expect(diasDelRango("pasada", martes).map((d) => d.dia)).toEqual(["2026-11-02","2026-11-03","2026-11-04","2026-11-05","2026-11-06","2026-11-07","2026-11-08"]);
  expect(diasDelRango("hoy", martes)).toEqual([]);
  expect(diaAR("2026-11-10T02:30:00Z")).toBe("2026-11-09"); // 23:30 del lunes en AR
});
