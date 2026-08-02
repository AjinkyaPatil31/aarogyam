import './globals.css';
import SessionGuard from './components/SessionGuard';
import { ToastProvider } from '@/app/context/ToastContext';

export const metadata = {
  title: 'Aarogyam \u2014 Healthcare Ecosystem',
  description:
    'Aarogyam is a web-based healthcare ecosystem providing dedicated dashboards and portals for patients and doctors.'};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-800 antialiased">
        <ToastProvider>
          <SessionGuard>
            {children}
          </SessionGuard>
        </ToastProvider>
      </body>
    </html>
  );
}
