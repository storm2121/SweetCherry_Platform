import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../context/useAuth.js';
import { createDiagnosisSubmission } from '../services/farmerService.js';
import '../styles/field-context.css';

const PlantScanCard = () => {
  const { user } = useAuth();
  const inputId = useId();
  const fileInputRef = useRef(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(
    () => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); },
    [imageUrl],
  );

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    setImageUrl(URL.createObjectURL(file));
    setErrorMsg('');
    setStatus('uploading');
    try {
      await createDiagnosisSubmission({ farmer: user, imageFile: file });
      setStatus('submitted');
    } catch {
      setErrorMsg('تعذر إرسال الصورة للخبير. تحقق من الاتصال ثم اختر الصورة من جديد.');
      setStatus('error');
    }
  };

  const reset = () => {
    setImageUrl(null);
    setErrorMsg('');
    setStatus('idle');
  };

  return (
    <section className="plant-scan" aria-labelledby={inputId + '-title'} aria-busy={status === 'uploading'}>
      <div className="field-heading">
        <div>
          <p className="field-eyebrow">صورة من الحقل</p>
          <h2 id={inputId + '-title'}>اطلب مراجعة الخبير</h2>
          <p className="field-muted">صورة واضحة للجزء المصاب تساعد الخبير على فهم المشكلة. تظهر النتيجة بعد مراجعته واعتمادها.</p>
        </div>
        <span className="field-status">مراجعة بشرية</span>
      </div>

      <div className="plant-scan__body">
        {status === 'idle' ? (
          <div className="plant-scan__empty">
            <p className="field-muted">أرسل صورة من جهازك أو الكاميرا، ثم تابع الطلب في المعرض.</p>
            <button
              type="button"
              className="field-button"
              aria-controls={inputId}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M4 6h4l2-3h4l2 3h4v14H4z" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="4" />
              </svg>
              اختيار صورة للخبير
            </button>
          </div>
        ) : (
          <div className="plant-scan__result">
            {imageUrl ? <img src={imageUrl} alt="الصورة المختارة للمراجعة" className="plant-scan__preview" /> : null}
            {status === 'uploading' ? (
              <p className="field-muted" role="status">جارٍ إرسال الصورة إلى قائمة مراجعة الخبراء...</p>
            ) : null}
            {status === 'submitted' ? (
              <>
                <div className="field-notice field-notice--ready" role="status">
                  <strong>وصلت الصورة إلى الخبراء</strong>
                  <p className="field-muted">تابع حالتها ونتيجة المراجعة من تبويب المعرض.</p>
                </div>
                <button type="button" className="field-button field-button--secondary" onClick={reset}>إرسال صورة أخرى</button>
              </>
            ) : null}
            {status === 'error' ? (
              <>
                <p className="field-muted" role="alert">{errorMsg}</p>
                <button type="button" className="field-button field-button--secondary" onClick={reset}>اختيار الصورة من جديد</button>
              </>
            ) : null}
          </div>
        )}
      </div>

      <input
        id={inputId}
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        disabled={status === 'uploading'}
        aria-label="الصورة المرسلة للخبير"
        hidden
      />
    </section>
  );
};

export default PlantScanCard;

