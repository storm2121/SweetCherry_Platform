import { lazy, Suspense, useEffect, useState } from 'react';
import LoginPage from './pages/LoginPage.jsx';
import LandingPage from './pages/Landing/LandingPage.jsx';
import { useAuth } from './context/useAuth.js';
import { AUTH_COPY } from './i18n/authCopy.js';
import { dirFor, storedLanguage } from './i18n/language.js';
const FarmerDashboard = lazy(() => import('./pages/FarmerDashboard/FarmerDashboard.jsx'));
const ExpertDashboard = lazy(() => import('./pages/ExpertDashboard/ExpertDashboard.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const PendingExpert = lazy(() => import('./pages/PendingExpert.jsx'));
const Loading = () => {
  const lang = storedLanguage();
  return <main className="sc-loading" role="status" lang={lang} dir={dirFor(lang)}>{AUTH_COPY[lang].loading}</main>;
};
const App = () => {
  const { user, loading } = useAuth();
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  const navigate = (nextPath) => { window.history.pushState({}, '', nextPath); setPath(nextPath); window.scrollTo(0, 0); };
  if (!user) {
    if (path === '/login') return <LoginPage key={path} onNavigate={navigate} />;
    if (path === '/register' || path === '/register/expert') return <LoginPage key={path} initialMode="register" initialRole={path.endsWith('/expert') ? 'expert' : 'farmer'} onNavigate={navigate} />;
    return <LandingPage onNavigate={navigate} />;
  }
  if (loading) return <Loading />;
  let content;
  if (user.role === 'admin') content = <AdminDashboard />;
  else if (user.role === 'expert' && user.status !== 'approved') content = <PendingExpert status={user.status} />;
  else if (user.role === 'expert') content = <ExpertDashboard />;
  else content = <FarmerDashboard />;
  return <Suspense fallback={<Loading />}><div className="sc-workspace" dir="rtl" lang="ar">{content}</div></Suspense>;
};
export default App;
