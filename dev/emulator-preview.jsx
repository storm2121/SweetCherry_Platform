// Development-only preview of the app against the local emulators (seeded by
// tests/rules/seed-demo.mjs). Start Vite with the default emulator configuration, then open
// /dev/emulator-preview.html with:
//   ?as=expertA, ?as=farmerA&view=farmer, ?as=adminA, ?as=farmerA&view=questions
//   ?view=landing, ?view=login or ?view=register (signed out)
import { createRoot } from 'react-dom/client';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../src/config/firebase.js';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import AdminDashboard from '../src/pages/AdminDashboard.jsx';
import ExpertDashboard from '../src/pages/ExpertDashboard/ExpertDashboard.jsx';
import FarmerDashboard from '../src/pages/FarmerDashboard/FarmerDashboard.jsx';
import PageExpertQuestions from '../src/pages/FarmerDashboard/PageExpertQuestions.jsx';
import LandingPage from '../src/pages/Landing/LandingPage.jsx';
import LoginPage from '../src/pages/LoginPage.jsx';
import PendingExpert from '../src/pages/PendingExpert.jsx';
import '../src/styles/globals.css';

const PHONES = {
  farmerA: '212600000001',
  farmerB: '212600000002',
  expertA: '212600000003',
  expertB: '212600000004',
  expertC: '966500000008',
  adminA: '212600000006',
};

const params = new URLSearchParams(window.location.search);
const view = params.get('view');
const account = params.get('as') || 'expertA';

localStorage.removeItem('scUser');

// Signed-out pages, with links kept inside the preview.
const PUBLIC_PAGES = {
  landing: (go) => <LandingPage onNavigate={go} />,
  login: (go) => <LoginPage key="login" onNavigate={go} />,
  register: (go) => <LoginPage key="register" initialMode="register" onNavigate={go} />,
};
const goPublic = (path) => {
  const target = { '/login': 'login', '/register': 'register', '/register/expert': 'register' }[path] ?? 'landing';
  window.location.search = `?view=${target}`;
};

let content;
if (PUBLIC_PAGES[view]) {
  await signOut(auth);
  content = PUBLIC_PAGES[view](goPublic);
} else {
  await signInWithEmailAndPassword(auth, `${PHONES[account]}@sweetcherry.ma`, 'demo-pass-1234');
  const VIEWS = { questions: PageExpertQuestions, farmer: FarmerDashboard, expert: ExpertDashboard, admin: AdminDashboard, pending: PendingExpert };
  const DEFAULT_VIEW = { farmer: FarmerDashboard, expert: ExpertDashboard, admin: AdminDashboard };
  const View = VIEWS[view] ?? (account === 'expertC' ? PendingExpert : DEFAULT_VIEW[account.replace(/[A-Z]$/, '')]) ?? ExpertDashboard;
  content = View === PendingExpert ? <PendingExpert status="pending" /> : View === PageExpertQuestions ? (
    <div dir="rtl" style={{ padding: '1.25rem 1rem 3rem', maxWidth: 1280, margin: '0 auto' }}>
      <View />
    </div>
  ) : (
    <View />
  );
}

createRoot(document.getElementById('root')).render(<AuthProvider><div role="note" dir="rtl" style={{ padding: '0.65rem 1rem', background: '#f6eed9', color: '#4b3825', textAlign: 'center' }}>بيئة تجريبية محلية. الحسابات وبيانات السوق والنصائح المعروضة أمثلة للمحاكاة.</div>{content}</AuthProvider>);
