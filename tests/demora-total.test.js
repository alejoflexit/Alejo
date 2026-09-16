const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { esDemoradoFlexit, demoraTotal } = require('../src/demoraTotalShared');

test('particulares: los tres estados acordados y sus variantes; nunca ML', () => {
  for (const estado of [null, undefined, '', ' nan ', 'null', ' En camino al destinatario ', 'EN PLANTA DE PROCESAMIENTO']) {
    assert.equal(esDemoradoFlexit('Particular', estado), true);
    assert.equal(esDemoradoFlexit(' ML ', estado), false);
  }
  for (const estado of ['Nadie', 'Nadie 2DA visita', 'Entregado', 'Entregado 2DA visita', 'Cancelado', 'Reprogramado por comprador']) {
    assert.equal(esDemoradoFlexit('Particular', estado), false);
  }
});

test('total combina Meli y particulares, conserva desconocidos y evita división por cero', () => {
  assert.equal(demoraTotal({ cantidad:300, demorados:8, dem21:2, demorados_flexit:5 }).porcentaje, 5);
  assert.equal(demoraTotal({ cantidad:0, demorados_flexit:0 }), null);
  assert.equal(demoraTotal({ cantidad:300, demorados_flexit:null }), null);
  assert.equal(demoraTotal({ cantidad:300 }), null);
  assert.equal(demoraTotal({ cantidad:300, demorados_flexit:0 }).porcentaje, 0);
});

// Ejecutar las funciones reales sin iniciar la descarga ni renderizar toda la app.
function cargarFunciones(file, nombres) {
  const source = fs.readFileSync(require.resolve(file), 'utf8');
  const parser = require('@babel/parser');
  const ast = parser.parse(source, { sourceType:'unambiguous', plugins:['jsx'] });
  const declarations = ast.program.body.filter(n => n.type === 'FunctionDeclaration' && nombres.includes(n.id.name));
  assert.equal(declarations.length, nombres.length);
  const context = vm.createContext({ esDemoradoFlexit, slaMeli:()=>100, evaluar:()=>'', sumarHora:()=>{}, horaEntrega:()=>12 });
  vm.runInContext(declarations.map(n => source.slice(n.start,n.end)).join('\n'), context);
  return context;
}

test('carga manual y automática coinciden y no duplican ML/Repro 21', () => {
  const rows = [
    ...['', 'En camino al destinatario', 'En planta de procesamiento', 'Nadie', 'Entregado', 'Cancelado'].map(Estado => ({ Cadete:'Prueba', Origen:'Particular', Estado })),
    { Cadete:'Prueba', Origen:'ML', Estado:'En camino al destinatario', Domicilio:'Destino', 'ID (Interno)':'1' },
    { Cadete:'Prueba', Origen:'ML', Estado:'reprogramado por meli', Domicilio:'Destino', 'Fecha estado':'2026-09-15 22:00', 'ID (Interno)':'2' },
  ];
  for (const file of ['../src/App.js', '../automation/descargar_lightdata.js']) {
    const c = cargarFunciones(file, ['calcularDia','esRepro21hs']);
    const [m] = c.calcularDia(rows, '2026-09-15', new Set());
    assert.equal(m.demorados_flexit, 3);
    assert.equal(m.demorados, 1);
    assert.equal(m.dem21, 1);
    assert.equal(m.cantidad, 8);
    assert.equal(demoraTotal(m).porcentaje, 62.5);
  }
});

test('acumulado pondera por paquetes y no oculta días sin dato', () => {
  const { acumularSemana } = cargarFunciones('../src/App.js', ['acumularSemana']);
  const row = { cadete:'Prueba', cantidad:100, pendientes:0, demorados:0, envios_ml:50, dem21:0, demorados_flexit:10 };
  const dias = [{ datos:[row] }, { datos:[{ ...row, cantidad:300, demorados_flexit:0 }] }];
  assert.equal(demoraTotal(acumularSemana(dias)[0]).porcentaje, 2.5);
  dias[1].datos[0].demorados_flexit = null;
  assert.equal(demoraTotal(acumularSemana(dias)[0]), null);
});
