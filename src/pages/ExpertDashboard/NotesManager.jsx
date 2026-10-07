import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/useAuth.js';
import { REGIONS } from '../../services/constants.js';
import {
  deleteExpertNote,
  saveExpertNotesForRegions,
  subscribeExpertNotes,
} from '../../services/expertService.js';

// Each expert keeps one current note per region; saving again replaces it on
// the farmers' page.
const NotesManager = () => {
  const { user } = useAuth();
  const [notes, setNotes] = useState([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedRegions, setSelectedRegions] = useState([REGIONS[0]]);
  const [editingRegion, setEditingRegion] = useState('');
  const [status, setStatus] = useState(null);
  const [busyKey, setBusyKey] = useState('');

  useEffect(() => {
    const unsubscribe = subscribeExpertNotes(user?.uid, setNotes);
    return () => unsubscribe?.();
  }, [user?.uid]);

  const notesByRegion = useMemo(() => new Map(notes.map((note) => [note.region, note])), [notes]);

  const toggleRegion = (region) => {
    if (editingRegion) {
      setSelectedRegions([region]);
      setEditingRegion(region);
      const note = notesByRegion.get(region);
      setSubject(note?.subject || '');
      setBody(note?.body || '');
      return;
    }
    setSelectedRegions((prev) => (prev.includes(region) ? prev.filter((item) => item !== region) : [...prev, region]));
  };

  const startEdit = (note) => {
    setEditingRegion(note.region);
    setSelectedRegions([note.region]);
    setSubject(note.subject || '');
    setBody(note.body || '');
    setStatus(null);
  };

  const resetForm = () => {
    setSubject('');
    setBody('');
    setSelectedRegions([REGIONS[0]]);
    setEditingRegion('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!subject.trim() || !body.trim() || !selectedRegions.length) return;
    setBusyKey('save');
    setStatus(null);
    try {
      await saveExpertNotesForRegions({ expert: user, subject, body, regions: selectedRegions });
      setStatus({
        tone: 'ready',
        text:
          selectedRegions.length > 1
            ? 'حُفظ التوجيه لكل منطقة مختارة.'
            : 'حُفظ التوجيه وحلّ محل توجيهك السابق لهذه المنطقة.',
      });
      resetForm();
    } catch (error) {
      console.error('Failed to save expert note', error);
      setStatus({ tone: 'danger', text: 'تعذّر حفظ التوجيه. حاول مرة أخرى.' });
    } finally {
      setBusyKey('');
    }
  };

  const handleDelete = async (note) => {
    if (!window.confirm(`حذف توجيهك الحالي لمنطقة ${note.region}؟ لن يظهر للمزارعين بعد الحذف.`)) return;
    setBusyKey(`delete:${note.region}`);
    setStatus(null);
    try {
      await deleteExpertNote({ expert: user, region: note.region });
      if (editingRegion === note.region) resetForm();
      setStatus({ tone: 'ready', text: 'حُذف التوجيه من صفحة المزارعين.' });
    } catch (error) {
      console.error('Failed to delete expert note', error);
      setStatus({ tone: 'danger', text: 'تعذّر حذف التوجيه. حاول مرة أخرى.' });
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="notes-desk">
      <form className="desk-surface notes-form" onSubmit={handleSubmit}>
        <div className="desk-heading">
          <div>
            <h2>{editingRegion ? `تعديل توجيه ${editingRegion}` : 'توجيه جديد للمزارعين'}</h2>
            <p>يظهر للمزارعين في المنطقة المختارة، ويحلّ محل توجيهك السابق لها.</p>
          </div>
        </div>

        <label className="desk-field">
          <span>العنوان</span>
          <input
            className="desk-input"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="مثال: الري خلال موجة الحرارة"
            maxLength={200}
            required
          />
        </label>

        <label className="desk-field">
          <span>النص</span>
          <textarea
            className="desk-textarea"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="ما يجب على المزارع فعله، ومتى، ولماذا."
            maxLength={5000}
            rows={7}
            required
          />
        </label>

        <div className="review-choice" role="group" aria-label="المناطق">
          <span className="review-choice__label">{editingRegion ? 'المنطقة' : 'المناطق'}</span>
          <div className="review-choice__options">
            {REGIONS.map((region) => (
              <button
                key={region}
                type="button"
                className="review-option"
                aria-pressed={selectedRegions.includes(region)}
                onClick={() => toggleRegion(region)}
              >
                {region}
                {notesByRegion.has(region) ? ' · منشور' : ''}
              </button>
            ))}
          </div>
        </div>

        <div className="desk-composer__row">
          {editingRegion ? (
            <button type="button" className="desk-button" onClick={resetForm} disabled={Boolean(busyKey)}>
              إلغاء التعديل
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            className="desk-button desk-button--primary"
            disabled={Boolean(busyKey) || !selectedRegions.length}
          >
            {busyKey === 'save' ? 'جارٍ الحفظ…' : editingRegion ? 'حفظ التعديل' : 'نشر التوجيه'}
          </button>
        </div>

        {status ? (
          <p className={`desk-notice desk-notice--${status.tone}`} role={status.tone === 'danger' ? 'alert' : 'status'}>
            {status.text}
          </p>
        ) : null}
      </form>

      <section className="desk-surface notes-current" aria-labelledby="current-notes-title">
        <div className="desk-heading">
          <div>
            <h2 id="current-notes-title">توجيهاتي المنشورة</h2>
            <p>هذا ما يراه المزارعون الآن، منطقةً منطقة.</p>
          </div>
          <span className="desk-chip">{notes.length}</span>
        </div>

        {!notes.length ? <p className="desk-empty">لم تنشر أي توجيه بعد.</p> : null}

        <ul className="notes-list">
          {notes.map((note) => (
            <li key={note.id} className="notes-item">
              <div className="desk-item__top">
                <h3>{note.subject}</h3>
                <span className="desk-chip desk-chip--done">{note.region}</span>
              </div>
              <p className="desk-item__meta">آخر تعديل {formatTimestamp(note.updatedAt || note.createdAt)}</p>
              <p className="notes-item__body">{note.body}</p>
              <div className="notes-item__actions">
                <button type="button" className="desk-button desk-button--quiet" onClick={() => startEdit(note)} disabled={Boolean(busyKey)}>
                  تعديل
                </button>
                <button
                  type="button"
                  className="desk-button desk-button--quiet desk-button--danger"
                  onClick={() => handleDelete(note)}
                  disabled={Boolean(busyKey)}
                >
                  {busyKey === `delete:${note.region}` ? 'جارٍ الحذف…' : 'حذف'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

const formatTimestamp = (value) => {
  if (!value) return 'غير محدد';
  const date = value.toDate?.() ?? new Date(value.seconds ? value.seconds * 1000 : value);
  if (!date || Number.isNaN(date.getTime())) return 'غير محدد';
  return date.toLocaleString('ar-MA', { dateStyle: 'medium', timeStyle: 'short' });
};

export default NotesManager;
