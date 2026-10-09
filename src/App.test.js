import { render, screen } from '@testing-library/react';
import App from './App';

test('sin sesión pide usuario y contraseña antes de mostrar cualquier sección', () => {
  localStorage.removeItem('fx_session');
  window.location.hash = '#monitoreo';
  render(<App />);
  expect(screen.getByAltText('Flexit')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Contraseña')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  expect(screen.queryByText('Monitoreo del reparto')).toBeNull();
});
