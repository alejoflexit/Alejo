import { agregarSemana, construirSeguimiento, mensajeCadete } from "./seguimientoSla";
const fila = (cadete, ml, dem, d21=0) => ({ cadete, envios_ml:ml, demorados:dem, dem21:d21, demoradosDetalle:[], dem21Detalle:[] });
const sem = (label, filas) => ({ label, dias:[{ fecha:"2026-08-01", datos:filas }] });

test("agrega SLA sin promediar porcentajes diarios", () => {
  const s = { dias:[{datos:[fila("Jonathan",50,1)]},{datos:[fila("Jonathan",50,1,1)]}] };
  expect(agregarSemana(s)[0]).toMatchObject({ enviosMl:100, demorados:2, dem21:1, sla:97 });
});
test("prioriza críticos y marca reincidencia y muestra chica", () => {
  const r = construirSeguimiento([sem("ant",[fila("Jonathan",100,2),fila("Pedro",20,1)]),sem("act",[fila("Jonathan",100,6),fila("Pedro",20,1),fila("OK",100,1)])], "act");
  expect(r.filas.map(x=>x.cadete)).toEqual(["Jonathan","Pedro"]);
  expect(r.filas[0]).toMatchObject({ critico:true, muestraChica:false, slaAnterior:98 });
  expect(r.filas[1].muestraChica).toBe(true);
});
test("el ranking sigue el SLA de menor a mayor", () => {
  const r = construirSeguimiento([sem("ant",[fila("Reincidente",100,3),fila("Peor SLA",100,0)]),sem("act",[fila("Reincidente",100,3),fila("Peor SLA",100,8),fila("Intermedio",100,5)])], "act");
  expect(r.filas.map(x=>x.cadete)).toEqual(["Peor SLA","Intermedio","Reincidente"]);
});
test("mensaje incluye comparación, volumen y objetivo", () => {
  const t = mensajeCadete({ cadete:"Jonathan Dotta", sla:97, slaAnterior:98.2, delta:-1.2, enviosMl:100, demorados:2, dem21:1, muestraChica:false });
  expect(t).toContain("Hola Jonathan"); expect(t).toContain("97,00%"); expect(t).toContain("98,20%"); expect(t).toContain("100 envíos Flex"); expect(t).toContain("arriba del 98%");
});
