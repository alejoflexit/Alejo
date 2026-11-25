import { colectasAsignadas, evaluarControl, indexVinculos, resumenPorChofer, buscarCuentas, minutosDe } from './controlColectasShared';

const clientes = [
  { id: 'a', nombre: 'Cliente A' }, { id: 'b', nombre: 'Cliente B' }, { id: 'c', nombre: 'Cliente C' },
  { id: 'd', nombre: 'Cliente D' }, { id: 'e', nombre: 'Cliente E' },
];
const registros = {
  a: { id: 1, estado: 'verde', choferes: ['Ana'] },
  b: { id: 2, estado: 'verde', choferes: ['Ana'] },
  c: { id: 3, estado: 'amarillo', choferes: ['Ana', 'Beto'], confirmado_por: ['Beto'] },
  d: { id: 4, estado: 'rojo', choferes: ['Ana'] },
  e: { id: 5, estado: 'verde', choferes: ['A coordinar'] },
};
const vinculos = indexVinculos([
  { cliente_id: 'a', ld_id: 10 }, { cliente_id: 'b', ld_id: 20 }, { cliente_id: 'b', ld_id: 21 },
]);

test('asignadas: excluye rojo, A coordinar y choferes no confirmados', () => {
  const as = colectasAsignadas(registros, clientes);
  expect(as.map(a => a.clienteId).sort()).toEqual(['a', 'b', 'c']);
  expect(as.find(a => a.clienteId === 'c').choferes).toEqual(['Beto']);
});

test('estados: colectada por cualquiera de sus cuentas, sin vincular, pendiente antes del corte', () => {
  const r = evaluarControl({ asignadas: colectasAsignadas(registros, clientes), vinculos, ldPorCliente: { 21: 3 }, ahoraMin: minutosDe('12:00'), corteMin: minutosDe('13:30'), esHoy: true });
  const est = Object.fromEntries(r.items.map(i => [i.clienteId, i.estado]));
  expect(est).toEqual({ a: 'pendiente', b: 'colectada', c: 'sin_vincular' });
  expect(r.items.find(i => i.clienteId === 'b').cantidad).toBe(3);
});

test('vencida después del corte; nunca vencida si LightData no respondió', () => {
  const as = colectasAsignadas(registros, clientes);
  const tarde = evaluarControl({ asignadas: as, vinculos, ldPorCliente: {}, ahoraMin: minutosDe('13:30'), corteMin: minutosDe('13:30'), esHoy: true });
  expect(tarde.items.find(i => i.clienteId === 'a').estado).toBe('vencida');
  const caido = evaluarControl({ asignadas: as, vinculos, ldPorCliente: null, ahoraMin: minutosDe('15:00'), corteMin: minutosDe('13:30'), esHoy: true });
  expect(caido.items.find(i => i.clienteId === 'a').estado).toBe('sin_datos');
});

test('marca manual gana y cuenta compartida se avisa', () => {
  const regs = { ...registros, a: { ...registros.a, colectado_manual_at: '2026-11-25T15:00:00Z' } };
  const v = indexVinculos([{ cliente_id: 'a', ld_id: 10 }, { cliente_id: 'b', ld_id: 10 }]);
  const r = evaluarControl({ asignadas: colectasAsignadas(regs, clientes), vinculos: v, ldPorCliente: {}, ahoraMin: 900, corteMin: 810, esHoy: true });
  expect(r.items.find(i => i.clienteId === 'a').estado).toBe('colectada');
  expect(r.items.find(i => i.clienteId === 'b').compartida).toBe(true);
});

test('resumen por chofer y búsqueda', () => {
  const r = evaluarControl({ asignadas: colectasAsignadas(registros, clientes), vinculos, ldPorCliente: { 10: 1 }, ahoraMin: 0, corteMin: 810, esHoy: true });
  expect(resumenPorChofer(r.items)).toEqual({ Ana: { total: 2, colectadas: 1 }, Beto: { total: 1, colectadas: 0 } });
  expect(buscarCuentas([{ id: 1, nombre: 'Ámbito Pinturerías' }], 'ambito').length).toBe(1);
});
