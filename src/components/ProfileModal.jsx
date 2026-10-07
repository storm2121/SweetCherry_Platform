import { useEffect, useRef } from 'react';
import '../styles/workspace.css';
import { useAuth } from '../context/useAuth.js';

const ROLE_LABELS = { farmer: 'مزارع', expert: 'خبير', admin: 'مسؤول المنصة' };

// Account details, the hydroponics module and sign-out. Focus moves into the
// dialog, stays there while it is open, and returns to the opener on close.
const ProfileModal = ({ onClose, onOpenHydroponics }) => {
  const { user, logout } = useAuth();
  const dialogRef = useRef(null);

  useEffect(() => {
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector('button')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = dialog.querySelectorAll('button, a[href]');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [onClose]);

  const signOut = async () => {
    onClose();
    await logout();
  };

  return (
    <div className="ws-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="ws-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <header className="ws-dialog__head">
          <h2 id="account-title">الحساب</h2>
          <button type="button" className="desk-button desk-button--quiet" onClick={onClose}>
            إغلاق
          </button>
        </header>

        <dl className="ws-facts">
          <div>
            <dt>الاسم</dt>
            <dd>{user?.name || '—'}</dd>
          </div>
          <div>
            <dt>الهاتف</dt>
            <dd><bdi dir="ltr">{user?.phone || '—'}</bdi></dd>
          </div>
          {user?.city ? (
            <div>
              <dt>المنطقة</dt>
              <dd>{user.city}</dd>
            </div>
          ) : null}
          <div>
            <dt>نوع الحساب</dt>
            <dd>{ROLE_LABELS[user?.role] ?? user?.role ?? '—'}</dd>
          </div>
        </dl>

        {onOpenHydroponics ? (
          <button
            type="button"
            className="ws-dialog__module"
            onClick={() => {
              onClose();
              onOpenHydroponics();
            }}
          >
            <span>
              <strong>وحدة الزراعة المائية</strong>
              <span className="ws-sub">قراءات جهاز ESP32 والمضخة وتحليل صور النبات. وحدة تجريبية.</span>
            </span>
            <span aria-hidden="true">←</span>
          </button>
        ) : null}

        <button type="button" className="desk-button desk-button--danger ws-dialog__signout" onClick={signOut}>
          تسجيل الخروج
        </button>
      </section>
    </div>
  );
};

export default ProfileModal;
