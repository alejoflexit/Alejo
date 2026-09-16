import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DemoraTotalCell from './DemoraTotalCell';

test('desglose accesible por toque, hover y teclado; Escape cierra', () => {
  render(<DemoraTotalCell metricas={{ cadete:'Prueba', cantidad:300, demorados:8, dem21:2, demorados_flexit:5 }} />);
  const button = screen.getByRole('button', { name:'Demora total de Prueba' });
  expect(button.textContent).toContain('5,0%');
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.click(button);
  expect(screen.getByRole('tooltip').textContent).toContain('15 de 300 paquetes');
  fireEvent.keyDown(button, { key:'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.mouseEnter(button);
  expect(screen.getByRole('tooltip').textContent).toContain('Menor porcentaje');
  fireEvent.mouseLeave(button);
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.focus(button);
  expect(screen.getByRole('tooltip')).toBeTruthy();
  fireEvent.blur(button);
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('histórico incompleto explica por qué no muestra porcentaje', () => {
  render(<DemoraTotalCell metricas={{ cadete:'Prueba', cantidad:300, demorados_flexit:null }} />);
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('tooltip').textContent).toContain('Faltan datos');
});
