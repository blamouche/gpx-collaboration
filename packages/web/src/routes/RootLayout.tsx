import { Outlet, ScrollRestoration } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

const RootLayout = () => {
  return (
    <div className="app-shell">
      <Outlet />
      <ScrollRestoration />
      <Toaster position="top-right" toastOptions={{ duration: 2500 }} />
    </div>
  );
};

export default RootLayout;
