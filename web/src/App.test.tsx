import { render, screen } from '@testing-library/react';
import App from './App';

test('renders accueil', () => {
  render(<App />);
  expect(screen.getByText(/Accueil GPX Collaboration/i)).toBeInTheDocument();
});
