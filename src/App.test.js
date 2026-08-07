import { render, screen } from '@testing-library/react';
import App from './App';

test('renderiza el centro de operaciones Flexit', () => {
  render(<App />);
  expect(screen.getByAltText('Flexit')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ingresar' })).toBeInTheDocument();
});
