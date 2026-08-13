const test = require("node:test");
const assert = require("node:assert/strict");

const { historialExcluyeDemora } = require("../automation/demoras");

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
