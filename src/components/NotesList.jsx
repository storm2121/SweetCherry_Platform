import { contextDate } from '../utils/fieldPresentation.js';
import '../styles/field-context.css';

const NotesList = ({ notes = [], limit = null }) => {
  if (!notes.length) {
    return <p className="field-muted">لم ينشر الخبراء توجيهات لمنطقتك بعد.</p>;
  }
  const visibleNotes = Number.isFinite(limit) ? notes.slice(0, limit) : notes;

  return (
    <div className="field-notes">
      {visibleNotes.map((note) => (
        <article key={note.id} className="field-note">
          <h3>{note.subject || note.title || 'توجيه زراعي'}</h3>
          <p>{note.body}</p>
          <small>
            {note.expertName ? 'بواسطة ' + note.expertName + ' · ' : ''}
            {contextDate(note.updatedAt || note.createdAt)}
          </small>
        </article>
      ))}
    </div>
  );
};

export default NotesList;

