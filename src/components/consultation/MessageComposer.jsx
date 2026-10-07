import { useEffect, useId, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { formatDuration, useVoiceRecorder } from '../../hooks/useVoiceRecorder.js';
import { MESSAGE_BODY_MAX, validateMessage } from '../../services/expertRequestService.js';

// Text, with an optional photo or voice note. With an attachment the text is
// an optional caption. onSend({ type, body, file }) may throw; the draft is
// kept and the error shown.
const MessageComposer = ({
  onSend,
  label,
  placeholder = '',
  submitLabel = 'إرسال',
  hint = '',
  standalone = false,
  disabled = false,
}) => {
  const inputId = useId();
  const fileRef = useRef(null);
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const voice = useVoiceRecorder();

  const previewUrl = usePreviewUrl(photo);
  const attachment = photo ? { type: 'image', file: photo } : voice.file ? { type: 'audio', file: voice.file } : null;
  const type = attachment?.type ?? 'text';
  const busy = disabled || sending || voice.recording;

  const choosePhoto = (event) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    voice.discard();
    setPhoto(picked);
    setError(validateMessage({ type: 'image', body, file: picked }) ?? '');
  };

  const startVoice = () => {
    setPhoto(null);
    setError('');
    voice.start();
  };

  const submit = async (event) => {
    event.preventDefault();
    const message = { type, body, file: attachment?.file ?? null };
    const problem = validateMessage(message);
    if (problem) {
      setError(problem);
      return;
    }
    setSending(true);
    setError('');
    try {
      await onSend(message);
      setBody('');
      setPhoto(null);
      voice.discard();
    } catch (err) {
      setError(err?.message || 'تعذّر الإرسال. تحقق من الاتصال ثم أعد المحاولة.');
    } finally {
      setSending(false);
    }
  };

  return (
    <form className={`desk-composer${standalone ? ' desk-composer--standalone' : ''}`} onSubmit={submit} aria-busy={sending}>
      <label className="desk-field" htmlFor={inputId}>
        {label ? <span>{label}</span> : <span className="sr-only">نص الرسالة</span>}
        <textarea
          id={inputId}
          className="desk-textarea"
          value={body}
          maxLength={MESSAGE_BODY_MAX}
          placeholder={attachment ? 'تعليق اختياري على المرفق' : placeholder}
          onChange={(event) => setBody(event.target.value)}
          disabled={disabled || sending}
        />
      </label>

      {photo ? (
        <div className="desk-attachment">
          <span className="desk-attachment__file">
            {previewUrl ? <img src={previewUrl} alt="" /> : null}
            <span>{photo.name}</span>
          </span>
          <button type="button" className="desk-button desk-button--quiet desk-button--danger" onClick={() => setPhoto(null)}>
            إزالة
          </button>
        </div>
      ) : null}

      {voice.file ? (
        <div className="desk-attachment">
          <AudioPreview file={voice.file} />
          <button type="button" className="desk-button desk-button--quiet desk-button--danger" onClick={voice.discard}>
            حذف التسجيل
          </button>
        </div>
      ) : null}

      <div className="desk-composer__row">
        <div className="desk-composer__tools">
          <button type="button" className="desk-button" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="camera" size={18} />
            صورة
          </button>
          {voice.recording ? (
            <button type="button" className="desk-button" onClick={voice.stop}>
              <Icon name="stop" size={18} />
              إيقاف التسجيل <span className="desk-recording">{formatDuration(voice.seconds)}</span>
            </button>
          ) : (
            <button type="button" className="desk-button" onClick={startVoice} disabled={busy}>
              تسجيل صوتي
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={choosePhoto} />
        </div>
        <button type="submit" className="desk-button desk-button--primary" disabled={busy}>
          {sending ? 'جارٍ الإرسال…' : submitLabel}
        </button>
      </div>

      {hint ? <p className="desk-muted">{hint}</p> : null}
      {error || voice.error ? (
        <p className="desk-notice desk-notice--danger" role="alert">{error || voice.error}</p>
      ) : null}
    </form>
  );
};

const usePreviewUrl = (file) => {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
};

const AudioPreview = ({ file }) => {
  const url = usePreviewUrl(file);
  return url ? <audio controls src={url} aria-label="معاينة التسجيل" /> : null;
};

export default MessageComposer;
