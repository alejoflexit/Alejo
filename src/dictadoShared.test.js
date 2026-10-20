import { normalizarDictado } from './dictadoShared';

test('junta un número de envío dictado dígito por dígito', () => {
  expect(normalizarDictado('1 0 4 5 9 2 8')).toBe('1045928');
  expect(normalizarDictado('envío 104 59 28')).toBe('envío 1045928');
});

test('no pega calle + CP ni números cortos', () => {
  expect(normalizarDictado('Santa Magdalena 668 1405')).toBe('Santa Magdalena 668 1405');
  expect(normalizarDictado('Calle 70 317 La Plata')).toBe('Calle 70 317 La Plata');
  expect(normalizarDictado('1 de Marzo 1540 Llavallol')).toBe('1 de Marzo 1540 Llavallol');
});

test('deja igual un número que ya vino entero', () => {
  expect(normalizarDictado('  el 1045928  ')).toBe('el 1045928');
});
