import { contextDate, contextTimestamp } from '../utils/fieldPresentation.js';
import '../styles/field-context.css';

const AiNoteCard = ({ note, regionKey, error = '' }) => {
  const timestamp = contextTimestamp(note?.generatedAt);
  const currentKey = (regionKey || 'ai-note') + '-' + (timestamp || 'pending');

  return (
    <section
      className="field-advice"
      aria-labelledby="agricultural-note-title"
      data-tts-key={currentKey}
      data-tts-clean-prefix={regionKey || undefined}
    >
      <div className="field-heading">
        <div>
          <p className="field-eyebrow">إرشاد زراعي</p>
          <h3 id="agricultural-note-title">مذكرة المنطقة</h3>
        </div>
        <span className="field-status">مولّدة آلياً</span>
      </div>
      {note?.content ? (
        <p className="field-advice__content">{note.content}</p>
      ) : (
        <p className="field-muted">{error || 'لا تتوفر مذكرة محدثة بعد. ستظهر هنا بعد وصول بيانات الطقس وتحديث الإرشادات.'}</p>
      )}
      <div className="field-data-meta">
        <span>تحديث المذكرة: {contextDate(note?.generatedAt)}</span>
        <span>تُقرأ مع توجيهات الخبير وحالة المزرعة.</span>
      </div>
      {error && note?.content ? <p className="field-muted" role="status">{error}</p> : null}
    </section>
  );
};

export default AiNoteCard;

