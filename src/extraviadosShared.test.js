import { parseValor, montoDe, cuotasDe, planDescuento, cadeteDePago, estadoCuotas, mondayOf, filtroEnvio } from './extraviadosShared';

test('parseValor entiende los formatos de LightData y del Excel', () => {
  expect(parseValor('92199.00')).toBe(92199);
  expect(parseValor('92.199,00')).toBe(92199);
  expect(parseValor('$ 39,500.00')).toBe(39500);
  expect(parseValor('$39.500')).toBe(39500);
  expect(parseValor('24573,38')).toBe(24573.38);
  expect(parseValor('S/N')).toBe(null);
  expect(parseValor('')).toBe(null);
});

test('el valor manual manda sobre el declarado', () => {
  expect(montoDe({ valor_declarado: 92199, valor_manual: null })).toBe(92199);
  expect(montoDe({ valor_declarado: 92199, valor_manual: 50000 })).toBe(50000);
  expect(montoDe({ valor_declarado: null, valor_manual: null })).toBe(null);
});

test('las cuotas suman exacto y la última absorbe el redondeo', () => {
  expect(cuotasDe(100000, 3)).toEqual([33333, 33333, 33334]);
  expect(cuotasDe(24573.38, 1)).toEqual([24573]);
  expect(cuotasDe(0, 3)).toEqual([]);
  const c = cuotasDe(157181.25, 4);
  expect(c.reduce((a, b) => a + b, 0)).toBe(157181);
});

test('planDescuento: una fila de pagos_ajustes por semana consecutiva', () => {
  const p = planDescuento({ id: 7, tipo: 'roto', fecha: '2026-11-12', cliente: 'Dips online', codigo: '2000019384679834',
    cadete: 'Natalia', valor_declarado: 90000, cuotas: 3, semana_inicio: '2026-11-09' });
  expect(p.map((x) => x.semana_label)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23']);
  expect(p.map((x) => x.monto)).toEqual([30000, 30000, 30000]);
  expect(p[1].concepto).toBe('Roto 12/11 · Dips online · 2000019384679834 (cuota 2/3)');
  expect(p[0]).toMatchObject({ cadete: 'Natalia', extraviado_id: 7, cuota: 1 });
  expect(planDescuento({ id: 1, cadete: '', valor_declarado: 1, semana_inicio: '2026-11-09' })).toEqual([]);
});

test('cadeteDePago resuelve alias y tarifas', () => {
  const tarifas = [{ nombre_lightdata: 'Yamila Gomez' }, { nombre_lightdata: 'Nahuel Saez' }];
  const alias = [{ nombre_lightdata: 'yamila g', regla: 'merge', paga_como: 'Yamila Gomez' }];
  expect(cadeteDePago('Yamila G', tarifas, alias)).toBe('Yamila Gomez');
  expect(cadeteDePago('nahuel  saez', tarifas, alias)).toBe('Nahuel Saez');
  expect(cadeteDePago('Desconocido', tarifas, alias)).toBe('');
});

test('estadoCuotas cuenta lo ya pagado', () => {
  const aj = [{ semana_label: '2026-11-16', monto: 500, pagado: false }, { semana_label: '2026-11-09', monto: 500, pagado: true }];
  expect(estadoCuotas(aj)).toMatchObject({ n: 2, pagadas: 1, descontado: 500, resta: 500, proxima: '2026-11-16' });
});

test('mondayOf y filtroEnvio', () => {
  expect(mondayOf('2026-11-13')).toBe('2026-11-09');
  expect(mondayOf('2026-11-15')).toBe('2026-11-09');
  expect(mondayOf('2026-11-09')).toBe('2026-11-09');
  expect(filtroEnvio(' 2000019384679834 ')).toBe('or=(id_venta_ml.eq.2000019384679834,tracking.eq.2000019384679834,id_interno.eq.2000019384679834)');
  expect(filtroEnvio('a b,c')).toBe(null);
});
