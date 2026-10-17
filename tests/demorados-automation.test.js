const test = require("node:test");
const assert = require("node:assert/strict");

const { historialExcluyeDemora, historialExcluyeDem21 } = require("../automation/demoras");

test("un cancelado del dia no se cuenta como demora aunque luego vuelva a planta", async () => {
  const excluye = historialExcluyeDemora([
    { estado: "8", fecha: "12/08/2026 13:48" },
    { estado: "1", fecha: "12/08/2026 15:16" },
    { estado: "2", fecha: "12/08/2026 15:53" },
  ], new Set(["2026-08-12", "2026-08-11"]));
  assert.equal(excluye, true);
});

test("un cancelado antiguo no oculta una demora nueva", async () => {
  const excluye = historialExcluyeDemora([
    { estado: "8", fecha: "10/08/2026 13:48" },
    { estado: "1", fecha: "12/08/2026 15:16" },
  ], new Set(["2026-08-12", "2026-08-11"]));
  assert.equal(excluye, false);
});

test("un cancelado del dia excluye la demora sin importar la hora", async () => {
  const excluye = historialExcluyeDemora([
    { estado: "8", fecha: "12/08/2026 21:30" },
    { estado: "1", fecha: "12/08/2026 22:00" },
  ], new Set(["2026-08-12", "2026-08-11"]));
  assert.equal(excluye, true);
});

test("un entregado del dia no es demora aunque el Excel haya quedado en camino", () => {
  const excluye = historialExcluyeDemora([
    { estado: "2", fecha: "12/08/2026 18:00" },
    { estado: "5", fecha: "12/08/2026 19:52" },
  ], new Set(["2026-08-12", "2026-08-11"]));
  assert.equal(excluye, true);
});

test("Nadie antes de las 21 evita un falso repro 21 por actualización tardía de Meli", () => {
  const historial = [
    { estado: "6", fecha: "11/09/2026 18:26" },
    { estado: "11", fecha: "11/09/2026 23:10" },
  ];
  assert.equal(historialExcluyeDem21(historial, "2026-09-11"), true);
});

test("un intento exactamente a las 21 sí conserva la penalización dem21", () => {
  const historial = [
    { estado: "6", fecha: "11/09/2026 21:00" },
    { estado: "11", fecha: "11/09/2026 23:10" },
  ];
  assert.equal(historialExcluyeDem21(historial, "2026-09-11"), false);
});

test("reprogramado por comprador antes de las 21 evita el falso dem21 posterior", () => {
  const historial = [
    { estado: "12", fecha: "11/09/2026 18:48" },
    { estado: "6", fecha: "11/09/2026 18:48" },
    { estado: "11", fecha: "11/09/2026 23:07" },
  ];
  assert.equal(historialExcluyeDem21(historial, "2026-09-11"), true);
});

test("un intento temprano de otro día no altera el dem21 del día procesado", () => {
  const historial = [
    { estado: "6", fecha: "10/09/2026 18:26" },
    { estado: "11", fecha: "11/09/2026 23:10" },
  ];
  assert.equal(historialExcluyeDem21(historial, "2026-09-11"), false);
});

test("estado 31 (reprogramado por meli de LightData) antes de las 21 excusa la demora", async () => {
  // Envío 1041101, 16/10/2026: A planta 14:55, 31 por Sistema 15:13, En camino 15:14.
  const excluye = historialExcluyeDemora([
    { estado: "0", fecha: "16/10/2026 13:19" },
    { estado: "1", fecha: "16/10/2026 14:55" },
    { estado: "31", fecha: "16/10/2026 15:13" },
    { estado: "2", fecha: "16/10/2026 15:14" },
  ], new Set(["2026-10-16", "2026-10-15"]));
  assert.equal(excluye, true);
});

test("estado 31 después de las 21 no excusa la demora", async () => {
  const excluye = historialExcluyeDemora([
    { estado: "2", fecha: "16/10/2026 17:45" },
    { estado: "31", fecha: "16/10/2026 23:14" },
  ], new Set(["2026-10-16", "2026-10-15"]));
  assert.equal(excluye, false);
});

test("dem21: un 31 antes de las 21 cuenta como intento previo", async () => {
  const excluye = historialExcluyeDem21([
    { estado: "31", fecha: "16/10/2026 15:13" },
    { estado: "2", fecha: "16/10/2026 15:14" },
    { estado: "31", fecha: "16/10/2026 23:10" },
  ], "2026-10-16");
  assert.equal(excluye, true);
});
