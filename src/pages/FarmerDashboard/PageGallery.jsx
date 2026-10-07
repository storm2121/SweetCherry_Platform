import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/useAuth.js';
import MessageMedia from '../../components/consultation/MessageMedia.jsx';
import { subscribeFarmerDiagnoses, subscribeFarmerMediaMessages } from '../../services/farmerService.js';
import {
  BODY_PART_OPTIONS,
  DIAGNOSIS_STATUS,
  DIAGNOSIS_STATUS_META,
  PROBLEM_OPTIONS,
  SEVERITY_OPTIONS,
  optionLabel,
} from '../../services/diagnosisConstants.js';

const CHIP_TONE = {
  amber: 'desk-chip--waiting',
  blue: 'desk-chip--active',
  green: 'desk-chip--done',
  red: 'desk-chip--closed',
};

// The farmer's photos sent for expert review, newest first, with each
// expert result once it is approved.
const PageGallery = () => {
  const { user } = useAuth();
  const [diagnoses, setDiagnoses] = useState([]);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const stopDiagnoses = subscribeFarmerDiagnoses(user?.uid, setDiagnoses);
    const stopMessages = subscribeFarmerMediaMessages(user?.uid, setMessages);
    return () => {
      stopDiagnoses?.();
      stopMessages?.();
    };
  }, [user?.uid]);

  const sorted = useMemo(
    () => [...diagnoses].sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt)),
    [diagnoses],
  );
  const counts = useMemo(() => {
    const tally = { waiting: 0, review: 0, done: 0 };
    diagnoses.forEach((item) => {
      if (item.status === DIAGNOSIS_STATUS.awaiting) tally.waiting += 1;
      else if (item.status === DIAGNOSIS_STATUS.inReview) tally.review += 1;
      else tally.done += 1;
    });
    return tally;
  }, [diagnoses]);

  return (
    <section className="farm-page gallery" aria-labelledby="gallery-title">
      <header className="farm-page__intro">
        <h2 id="gallery-title">صوري المرسلة</h2>
        <p>
          كل صورة ترسلها من «المزرعة» يراجعها خبير قبل أن تظهر النتيجة هنا.
          {diagnoses.length ? (
            <span className="gallery__counts">
              {' '}بانتظار خبير {counts.waiting.toLocaleString('ar-MA')} · قيد المراجعة {counts.review.toLocaleString('ar-MA')} · انتهت مراجعتها{' '}
              {counts.done.toLocaleString('ar-MA')}
            </span>
          ) : null}
        </p>
      </header>

      {!sorted.length ? (
        <div className="desk-surface">
          <p className="desk-empty">
            لم ترسل أي صورة بعد. من قسم «المزرعة» اختر «اطلب مراجعة الخبير» وأرسل صورة واضحة للجزء المصاب.
          </p>
        </div>
      ) : null}

      <ul className="gallery__list">
        {sorted.map((item) => (
          <li key={item.id}>
            <DiagnosisItem item={item} />
          </li>
        ))}
      </ul>

      {messages.length ? (
        <section className="desk-surface gallery__legacy" aria-labelledby="legacy-title">
          <div className="desk-heading">
            <h3 id="legacy-title">رسائل سابقة للخبراء</h3>
            <p>أُرسلت قبل خدمة الأسئلة. لطرح سؤال جديد استخدم «أسئلتي».</p>
          </div>
          <ul className="gallery__legacy-list">
            {[...messages]
              .sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt))
              .map((message) => (
                <li key={message.id}>
                  <MessageMedia type={message.type} fileUrl={message.fileUrl} description="رسالة سابقة للخبراء" />
                  <span className="desk-item__meta">{formatDate(message.createdAt)}</span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
};

const DiagnosisItem = ({ item }) => {
  const meta = DIAGNOSIS_STATUS_META[item.status] ?? DIAGNOSIS_STATUS_META[DIAGNOSIS_STATUS.awaiting];
  const reviewed = item.status === DIAGNOSIS_STATUS.reviewed;
  const rejected = item.status === DIAGNOSIS_STATUS.rejected;
  const observations =
    Array.isArray(item.observations) && item.observations.length ? item.observations : Array.isArray(item.problems) ? item.problems : [];

  return (
    <article className="desk-surface gallery__item">
      <a className="gallery__photo" href={item.imageUrl} target="_blank" rel="noreferrer" aria-label="فتح الصورة بالحجم الكامل">
        <img src={item.imageUrl} alt="صورة أرسلتها للتشخيص" loading="lazy" />
      </a>
      <div className="gallery__body">
        <div className="desk-item__top">
          <h3>صورة {formatDate(item.createdAt)}</h3>
          <span className={`desk-chip ${CHIP_TONE[meta.tone] ?? ''}`}>{meta.label}</span>
        </div>

        {reviewed ? (
          <>
            {observations.length ? (
              <dl className="gallery__findings">
                {observations.map((observation, index) => (
                  <div key={`${observation.bodyPart}-${observation.problemType}-${index}`}>
                    <dt>{optionLabel(BODY_PART_OPTIONS, observation.bodyPart, 'جزء غير محدد')}</dt>
                    <dd>
                      {observation.problemType === 'other' && observation.manualLabel
                        ? observation.manualLabel
                        : optionLabel(PROBLEM_OPTIONS, observation.problemType, observation.manualLabel || 'غير محدد')}
                      <span className="ws-sub">الشدة: {optionLabel(SEVERITY_OPTIONS, observation.severity, 'غير محددة')}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>تمت المراجعة دون تحديد مشكلة واضحة.</p>
            )}
            {item.recommendedAction ? (
              <div className="gallery__advice">
                <h4>ما ينصح به الخبير</h4>
                <p>{item.recommendedAction}</p>
              </div>
            ) : null}
            <p className="desk-item__meta">
              راجعها {item.reviewedByName || 'خبير'} في {formatDate(item.reviewedAt)}
            </p>
          </>
        ) : null}

        {rejected ? (
          <p className="desk-notice desk-notice--warning">
            {item.expertNote || 'لم تكن الصورة كافية للتشخيص.'} أرسل صورة أقرب وأوضح للجزء المصاب في ضوء النهار.
          </p>
        ) : null}

        {!reviewed && !rejected ? (
          <p className="desk-muted">
            {item.status === DIAGNOSIS_STATUS.inReview
              ? `بدأ ${item.reviewedByName || 'أحد الخبراء'} مراجعتها.`
              : 'الصورة لدى الخبراء، وستظهر النتيجة هنا بعد المراجعة.'}
          </p>
        ) : null}
      </div>
    </article>
  );
};

const timestampMs = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'number') return value;
  if (value.seconds) return value.seconds * 1000;
  return Date.parse(value) || 0;
};

const formatDate = (value) => {
  const ms = timestampMs(value);
  if (!ms) return 'غير محدد';
  return new Date(ms).toLocaleString('ar-MA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
};

export default PageGallery;
