import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/useAuth.js';
import {
  CLAIM_MINUTES,
  claimDiagnosis,
  claimLapsed,
  describeReviewError,
  rejectDiagnosisReview,
  releaseDiagnosis,
  saveDiagnosisDraft,
  submitDiagnosisReview,
  subscribeVisionDiagnoses,
} from '../../services/expertService.js';
import {
  BODY_PART_OPTIONS,
  CONFIDENCE_OPTIONS,
  DIAGNOSIS_STATUS,
  DIAGNOSIS_STATUS_META,
  IMAGE_QUALITY_OPTIONS,
  PROBLEM_OPTIONS,
  SEVERITY_OPTIONS,
  SPREAD_OPTIONS,
} from '../../services/diagnosisConstants.js';
import WeatherContextPanel from '../../components/WeatherContextPanel.jsx';

const newObservation = () => ({
  bodyPart: 'leaf',
  problemType: 'unknown_needs_more_info',
  manualLabel: '',
  severity: 'mild',
  confidence: 'medium',
  spread: 'few_spots',
});

const INITIAL_FILTERS = {
  status: 'active',
  region: 'all',
  date: 'all',
  search: '',
};

const STATUS_FILTERS = [
  { value: 'active', label: 'تحتاج مراجعة' },
  { value: DIAGNOSIS_STATUS.awaiting, label: 'بانتظار خبير' },
  { value: DIAGNOSIS_STATUS.inReview, label: 'قيد المراجعة' },
  { value: DIAGNOSIS_STATUS.reviewed, label: 'منتهية' },
  { value: DIAGNOSIS_STATUS.rejected, label: 'مرفوضة' },
  { value: 'all', label: 'الكل' },
];

const UNSAVED_PROMPT = 'لديك تعديلات غير محفوظة على هذه المراجعة. هل تريد تركها؟';

const VisionQueue = () => {
  const { user } = useAuth();
  const [diagnoses, setDiagnoses] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [review, setReview] = useState(buildEmptyReview);
  const [baseline, setBaseline] = useState(() => JSON.stringify(buildEmptyReview()));
  const [amending, setAmending] = useState(false);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState(null);
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false);

  useEffect(
    () =>
      subscribeVisionDiagnoses(setDiagnoses, () =>
        setLoadError('تعذّر تحميل قائمة الصور. تحقق من الاتصال ثم أعد فتح الصفحة.'),
      ),
    [],
  );

  const orderedDiagnoses = useMemo(
    () =>
      [...diagnoses].sort((a, b) => {
        const rank = statusRank(a.status) - statusRank(b.status);
        return rank || timestampMs(a.createdAt) - timestampMs(b.createdAt);
      }),
    [diagnoses],
  );

  const regions = useMemo(
    () => uniqueStrings(orderedDiagnoses.map((diagnosis) => diagnosis.farmerRegion)).sort(),
    [orderedDiagnoses],
  );

  const filteredDiagnoses = useMemo(() => filterDiagnoses(orderedDiagnoses, filters), [orderedDiagnoses, filters]);

  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(STATUS_FILTERS.map((option) => [option.value, 0]));
    diagnoses.forEach((item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
      counts.all += 1;
      if (isActiveStatus(item.status)) counts.active += 1;
    });
    return counts;
  }, [diagnoses]);

  // The open photo stays open even when a filter or another expert's change
  // moves it out of the visible list.
  const selected =
    diagnoses.find((item) => item.id === selectedId) ?? (selectedId ? null : filteredDiagnoses[0] ?? null);

  const dirty = JSON.stringify(review) !== baseline;
  const access = reviewAccess(selected, user?.uid);
  const editable = access === 'mine' || (access === 'finished-mine' && amending);

  // Load the photo's saved review when another photo is opened, and pin it so
  // a status change (claiming it, for one) does not jump to another photo.
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    const next = selected ? buildReviewFromDiagnosis(selected) : buildEmptyReview();
    setReview(next);
    setBaseline(JSON.stringify(next));
    setAmending(false);
    setMessage(null);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warn before leaving the page with unsaved work.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const confirmLeave = useCallback(() => !dirty || window.confirm(UNSAVED_PROMPT), [dirty]);

  const openDiagnosis = (id) => {
    if (id === selected?.id) {
      setShowDetailOnMobile(true);
      return;
    }
    if (!confirmLeave()) return;
    setSelectedId(id);
    setShowDetailOnMobile(true);
  };

  const updateFilter = (field, value) => setFilters((current) => ({ ...current, [field]: value }));

  const handleField = (field, value) => setReview((current) => ({ ...current, [field]: value }));

  const handleObservationChange = (index, field, value) =>
    setReview((current) => ({
      ...current,
      observations: current.observations.map((observation, position) =>
        position === index ? { ...observation, [field]: value } : observation,
      ),
    }));

  const toggleVisiblePart = (part) =>
    setReview((current) => {
      const parts = new Set(current.visibleParts);
      if (parts.has(part)) parts.delete(part);
      else parts.add(part);
      return { ...current, visibleParts: Array.from(parts) };
    });

  const addObservation = () =>
    setReview((current) => ({ ...current, observations: [...current.observations, newObservation()] }));

  const duplicateObservation = (index) =>
    setReview((current) => ({
      ...current,
      observations: [
        ...current.observations.slice(0, index + 1),
        { ...current.observations[index] },
        ...current.observations.slice(index + 1),
      ],
    }));

  const removeObservation = (index) =>
    setReview((current) => ({
      ...current,
      observations: current.observations.filter((_, position) => position !== index),
    }));

  const run = async (action) => {
    if (!selected || saving) return;
    if (action === 'reviewed') {
      const errors = validateReview(review);
      if (errors.length) {
        setMessage({ tone: 'danger', text: errors[0] });
        return;
      }
    }

    setSaving(action);
    setMessage(null);
    try {
      if (action === 'claim') {
        // The banner above the form confirms the claim.
        await claimDiagnosis({ diagnosisId: selected.id, expert: user });
      } else if (action === 'release') {
        await releaseDiagnosis({ diagnosisId: selected.id });
        setBaseline(JSON.stringify(review));
        setMessage({ tone: 'ready', text: 'أُعيدت الصورة إلى القائمة.' });
      } else if (action === 'draft') {
        await saveDiagnosisDraft({ diagnosisId: selected.id, expert: user, review });
        setBaseline(JSON.stringify(review));
        setMessage({ tone: 'ready', text: 'حُفظت المسودة.' });
      } else if (action === 'reviewed') {
        await submitDiagnosisReview({ diagnosisId: selected.id, expert: user, review });
        setBaseline(JSON.stringify(review));
        setAmending(false);
        setMessage({ tone: 'ready', text: 'أُرسلت النتيجة إلى المزارع.' });
      } else if (action === 'rejected') {
        await rejectDiagnosisReview({ diagnosisId: selected.id, expert: user, review });
        setBaseline(JSON.stringify(review));
        setAmending(false);
        setMessage({ tone: 'ready', text: 'سُجّلت الصورة غير صالحة مع السبب، وسيراه المزارع.' });
      }
    } catch (error) {
      console.error('Diagnosis review action failed', error);
      setMessage({ tone: 'danger', text: describeReviewError(error) });
    } finally {
      setSaving('');
    }
  };

  // Ctrl/Cmd+S saves a draft and Ctrl/Cmd+Enter submits, while editing.
  useEffect(() => {
    if (!editable) return undefined;
    const onKey = (event) => {
      if (saving || !(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        run('draft');
      } else if (event.key === 'Enter') {
        event.preventDefault();
        run('reviewed');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, selected?.id, review, saving]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="review-desk">
      {loadError ? <p className="desk-notice desk-notice--danger" role="alert">{loadError}</p> : null}

      <div className="review-filters" role="group" aria-label="تصفية حسب الحالة">
        {STATUS_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="review-filter"
            aria-pressed={filters.status === option.value}
            onClick={() => updateFilter('status', option.value)}
          >
            {option.label}
            <span className="review-filter__count">{statusCounts[option.value] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="review-layout" data-view={showDetailOnMobile && selected ? 'detail' : 'list'}>
        <aside className="review-queue desk-split__list" aria-label="قائمة الصور">
          <div className="review-queue__tools">
            <label className="desk-field">
              <span className="sr-only">بحث</span>
              <input
                className="desk-input"
                value={filters.search}
                onChange={(event) => updateFilter('search', event.target.value)}
                placeholder="بحث بالاسم أو الهاتف أو المنطقة"
              />
            </label>
            <div className="review-queue__selects">
              <label className="desk-field">
                <span>المنطقة</span>
                <select className="desk-select" value={filters.region} onChange={(event) => updateFilter('region', event.target.value)}>
                  <option value="all">كل المناطق</option>
                  {regions.map((region) => (
                    <option key={region} value={region}>{region}</option>
                  ))}
                </select>
              </label>
              <label className="desk-field">
                <span>الفترة</span>
                <select className="desk-select" value={filters.date} onChange={(event) => updateFilter('date', event.target.value)}>
                  <option value="all">كل الوقت</option>
                  <option value="today">اليوم</option>
                  <option value="week">آخر 7 أيام</option>
                </select>
              </label>
            </div>
            <p className="desk-muted">
              {filteredDiagnoses.length} من {diagnoses.length} صورة
              {filters !== INITIAL_FILTERS ? (
                <>
                  {' · '}
                  <button type="button" className="desk-button desk-button--quiet" onClick={() => setFilters(INITIAL_FILTERS)}>
                    إعادة الضبط
                  </button>
                </>
              ) : null}
            </p>
          </div>

          {filteredDiagnoses.length ? (
            <ul className="desk-list review-queue__list">
              {filteredDiagnoses.map((diagnosis) => (
                <li key={diagnosis.id}>
                  <QueueItem
                    diagnosis={diagnosis}
                    viewerId={user?.uid}
                    selected={diagnosis.id === selected?.id}
                    onSelect={() => openDiagnosis(diagnosis.id)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="desk-empty">لا توجد صور مطابقة.</p>
          )}
        </aside>

        {selected ? (
          <>
            <section className="review-image desk-split__detail">
              <button
                type="button"
                className="desk-button desk-button--quiet desk-back"
                onClick={() => {
                  if (confirmLeave()) setShowDetailOnMobile(false);
                }}
              >
                رجوع إلى القائمة
              </button>
              {selected.imageUrl ? <ImageZoomViewer src={selected.imageUrl} alt={`صورة أرسلها ${selected.farmerName || 'المزارع'} للتشخيص`} /> : <p className="desk-muted">لا توجد صورة متاحة في هذا السجل.</p>}
              <dl className="review-facts">
                <div><dt>المزارع</dt><dd>{selected.farmerName || 'غير معروف'}</dd></div>
                <div><dt>المنطقة</dt><dd>{selected.farmerRegion || 'غير محددة'}</dd></div>
                <div><dt>الهاتف</dt><dd dir="ltr">{selected.farmerPhone || 'غير متوفر'}</dd></div>
                <div><dt>أُرسلت</dt><dd>{formatDate(selected.createdAt)}</dd></div>
              </dl>
            </section>

            <article className="review-form desk-split__detail" aria-labelledby="review-title">
              <header className="review-form__head">
                <div>
                  <p className="desk-muted">تشخيص يدوي من الخبير، دون نتيجة آلية</p>
                  <h2 id="review-title">
                    {selected.farmerName || 'مزارع'} · {selected.farmerRegion || 'منطقة غير محددة'}
                  </h2>
                </div>
                <StatusChip status={selected.status} />
              </header>

              <ClaimBanner
                access={access}
                diagnosis={selected}
                amending={amending}
                saving={saving}
                onClaim={() => run('claim')}
                onRelease={() => run('release')}
                onAmend={() => setAmending(true)}
              />

              <WeatherContextPanel diagnosis={selected} />

              <fieldset className="review-fields" disabled={!editable || Boolean(saving)}>
                <legend className="sr-only">بيانات المراجعة</legend>

                <ChoiceGroup
                  label="جودة الصورة"
                  value={review.imageQuality}
                  options={IMAGE_QUALITY_OPTIONS}
                  onChange={(value) => handleField('imageQuality', value)}
                />

                <ChoiceGroup
                  label="الأجزاء الظاهرة في الصورة"
                  values={review.visibleParts}
                  options={BODY_PART_OPTIONS}
                  onChange={toggleVisiblePart}
                />

                <section className="review-observations" aria-labelledby="observations-title">
                  <div className="desk-heading">
                    <div>
                      <h3 id="observations-title">الملاحظات التشخيصية</h3>
                      <p>ملاحظة لكل جزء مصاب أو مشكلة ظاهرة في الصورة.</p>
                    </div>
                    <button type="button" className="desk-button" onClick={addObservation}>
                      إضافة ملاحظة
                    </button>
                  </div>

                  {review.observations.map((observation, index) => (
                    <ObservationEditor
                      key={`${selected.id}-${index}`}
                      observation={observation}
                      index={index}
                      removable={review.observations.length > 1}
                      onChange={handleObservationChange}
                      onDuplicate={duplicateObservation}
                      onRemove={removeObservation}
                    />
                  ))}
                </section>

                <label className="desk-field">
                  <span>رسالة للمزارع</span>
                  <textarea
                    className="desk-textarea"
                    value={review.recommendedAction}
                    onChange={(event) => handleField('recommendedAction', event.target.value)}
                    rows={4}
                    placeholder="التشخيص باختصار، ما يفعله المزارع الآن، ومتى يرسل صورة جديدة إن احتاج."
                  />
                </label>
              </fieldset>

              <footer className="review-actions">
                {message ? (
                  <p className={`desk-notice desk-notice--${message.tone}`} role={message.tone === 'danger' ? 'alert' : 'status'}>
                    {message.text}
                  </p>
                ) : null}
                {editable ? (
                  <>
                    <div className="review-actions__buttons">
                      <button type="button" className="desk-button" disabled={Boolean(saving)} onClick={() => run('draft')}>
                        {saving === 'draft' ? 'جارٍ الحفظ…' : 'حفظ مسودة'}
                      </button>
                      <button type="button" className="desk-button desk-button--primary" disabled={Boolean(saving)} onClick={() => run('reviewed')}>
                        {saving === 'reviewed' ? 'جارٍ الإرسال…' : 'اعتماد النتيجة وإرسالها'}
                      </button>
                      <button type="button" className="desk-button desk-button--danger" disabled={Boolean(saving)} onClick={() => run('rejected')}>
                        {saving === 'rejected' ? 'جارٍ الحفظ…' : 'الصورة غير صالحة'}
                      </button>
                    </div>
                    <p className="desk-muted">
                      {dirty ? 'تعديلات غير محفوظة. ' : ''}Ctrl/⌘+S لحفظ المسودة، Ctrl/⌘+Enter للاعتماد.
                    </p>
                  </>
                ) : null}
              </footer>
            </article>
          </>
        ) : (
          <div className="desk-surface review-form">
            <p className="desk-empty">لا توجد صورة محددة.</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Who may edit the open photo, from the viewer's side.
const reviewAccess = (diagnosis, uid) => {
  if (!diagnosis) return 'none';
  const holder = diagnosis.reviewedBy ?? null;
  if (diagnosis.status === DIAGNOSIS_STATUS.awaiting) return 'open';
  if (diagnosis.status === DIAGNOSIS_STATUS.inReview) {
    if (holder === uid) return 'mine';
    if (!holder || claimLapsed(diagnosis)) return 'lapsed';
    return 'held';
  }
  return holder === uid ? 'finished-mine' : 'finished';
};

const ClaimBanner = ({ access, diagnosis, amending, saving, onClaim, onRelease, onAmend }) => {
  if (access === 'open') {
    return (
      <div className="review-claim">
        <p>الصورة بانتظار خبير. ابدأ المراجعة لحجزها حتى لا يعمل عليها خبير آخر في الوقت نفسه.</p>
        <button type="button" className="desk-button desk-button--primary" disabled={Boolean(saving)} onClick={onClaim}>
          {saving === 'claim' ? 'جارٍ الحجز…' : 'ابدأ المراجعة'}
        </button>
      </div>
    );
  }
  if (access === 'lapsed') {
    return (
      <div className="review-claim">
        <p>
          بدأ {diagnosis.reviewedByName || 'خبير آخر'} مراجعة هذه الصورة ولم يحفظ شيئاً منذ أكثر من {CLAIM_MINUTES} دقيقة.
        </p>
        <button type="button" className="desk-button desk-button--primary" disabled={Boolean(saving)} onClick={onClaim}>
          تولَّ المراجعة
        </button>
      </div>
    );
  }
  if (access === 'held') {
    return (
      <p className="desk-notice desk-notice--warning">
        يراجع {diagnosis.reviewedByName || 'خبير آخر'} هذه الصورة الآن (منذ {formatDate(diagnosis.claimedAt || diagnosis.updatedAt)}).
        يمكنك متابعتها دون تعديل.
      </p>
    );
  }
  if (access === 'mine') {
    return (
      <div className="review-claim review-claim--mine">
        <p>الصورة محجوزة لك. يتجدد الحجز ({CLAIM_MINUTES} دقيقة) مع كل حفظ.</p>
        <button type="button" className="desk-button" disabled={Boolean(saving)} onClick={onRelease}>
          إعادتها إلى القائمة
        </button>
      </div>
    );
  }
  if (access === 'finished-mine' && !amending) {
    return (
      <div className="review-claim">
        <p>أنهيت مراجعة هذه الصورة في {formatDate(diagnosis.reviewedAt)}.</p>
        <button type="button" className="desk-button" onClick={onAmend}>
          تعديل النتيجة
        </button>
      </div>
    );
  }
  if (access === 'finished') {
    return (
      <p className="desk-notice">
        راجعها {diagnosis.reviewedByName || 'خبير آخر'} في {formatDate(diagnosis.reviewedAt)}. التعديل متاح للخبير الذي راجعها فقط.
      </p>
    );
  }
  return null;
};

const ObservationEditor = ({ observation, index, removable, onChange, onDuplicate, onRemove }) => (
  <div className="review-observation">
    <div className="review-observation__head">
      <strong>ملاحظة {index + 1}</strong>
      <span className="review-observation__tools">
        <button type="button" className="desk-button desk-button--quiet" onClick={() => onDuplicate(index)}>
          نسخ
        </button>
        {removable ? (
          <button type="button" className="desk-button desk-button--quiet desk-button--danger" onClick={() => onRemove(index)}>
            حذف
          </button>
        ) : null}
      </span>
    </div>

    <ChoiceGroup label="جزء النبات" value={observation.bodyPart} options={BODY_PART_OPTIONS} onChange={(value) => onChange(index, 'bodyPart', value)} />
    <ChoiceGroup label="المشكلة" value={observation.problemType} options={PROBLEM_OPTIONS} onChange={(value) => onChange(index, 'problemType', value)} />

    {observation.problemType === 'other' ? (
      <label className="desk-field">
        <span>اسم المشكلة</span>
        <input className="desk-input" value={observation.manualLabel} onChange={(event) => onChange(index, 'manualLabel', event.target.value)} />
      </label>
    ) : null}

    <div className="review-observation__grid">
      <ChoiceGroup label="الشدة" value={observation.severity} options={SEVERITY_OPTIONS} onChange={(value) => onChange(index, 'severity', value)} />
      <ChoiceGroup label="ثقة الخبير" value={observation.confidence} options={CONFIDENCE_OPTIONS} onChange={(value) => onChange(index, 'confidence', value)} />
      <ChoiceGroup label="الانتشار" value={observation.spread} options={SPREAD_OPTIONS} onChange={(value) => onChange(index, 'spread', value)} />
    </div>
  </div>
);

// Single choice when `value` is given, multiple choice when `values` is given.
const ChoiceGroup = ({ label, value, values, options, onChange }) => (
  <div className="review-choice" role="group" aria-label={label}>
    <span className="review-choice__label">{label}</span>
    <div className="review-choice__options">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="review-option"
          aria-pressed={values ? values.includes(option.value) : value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

const ImageZoomViewer = ({ src, alt }) => {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const dragStartRef = useRef(null);
  const surfaceRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setFullscreen(false);
  }, [src]);

  useEffect(() => {
    if (!fullscreen) return undefined;
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const clampZoom = (value) => Math.min(4, Math.max(1, Number(value.toFixed(2))));

  const changeZoom = (nextZoom) => {
    const safeZoom = clampZoom(nextZoom);
    setZoom(safeZoom);
    if (safeZoom === 1) setOffset({ x: 0, y: 0 });
  };

  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  useEffect(() => {
    const node = surfaceRef.current;
    if (!node) return undefined;
    const handleWheel = (event) => {
      event.preventDefault();
      setZoom((current) => {
        const next = clampZoom(current + (event.deltaY > 0 ? -0.18 : 0.18));
        if (next === 1) setOffset({ x: 0, y: 0 });
        return next;
      });
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, [fullscreen]);

  const handlePointerDown = (event) => {
    if (zoom <= 1) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offset };
    setDragging(true);
  };

  const handlePointerMove = (event) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setOffset({ x: start.offset.x + event.clientX - start.x, y: start.offset.y + event.clientY - start.y });
  };

  const handlePointerUp = (event) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragStartRef.current = null;
    setDragging(false);
  };

  const controls = (
    <div className="zoom-controls">
      <button type="button" className="zoom-button" aria-label="تصغير" onClick={() => changeZoom(zoom - 0.25)}>−</button>
      <span className="zoom-level" aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button type="button" className="zoom-button" aria-label="تكبير" onClick={() => changeZoom(zoom + 0.25)}>+</button>
      <button type="button" className="zoom-button" onClick={reset}>الحجم الأصلي</button>
      {fullscreen ? (
        <button ref={closeRef} type="button" className="zoom-button" onClick={() => setFullscreen(false)}>إغلاق</button>
      ) : (
        <button type="button" className="zoom-button" onClick={() => setFullscreen(true)}>ملء الشاشة</button>
      )}
    </div>
  );

  const surface = (
    <div
      ref={surfaceRef}
      className={`zoom-surface${fullscreen ? ' zoom-surface--full' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <img
        src={src}
        alt={alt}
        draggable="false"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
        }}
        onDoubleClick={() => changeZoom(zoom > 1 ? 1 : 2)}
      />
    </div>
  );

  return (
    <>
      <div className="zoom-viewer">
        {controls}
        {surface}
        <p className="desk-muted">عجلة الفأرة أو النقر المزدوج للتكبير، ثم اسحب الصورة لتحريكها.</p>
      </div>
      {fullscreen ? (
        <div className="zoom-overlay" role="dialog" aria-modal="true" aria-label="الصورة بملء الشاشة">
          {controls}
          {surface}
        </div>
      ) : null}
    </>
  );
};

const QueueItem = ({ diagnosis, viewerId, selected, onSelect }) => {
  const heldBy =
    diagnosis.status === DIAGNOSIS_STATUS.inReview && diagnosis.reviewedBy
      ? diagnosis.reviewedBy === viewerId
        ? 'أنت'
        : diagnosis.reviewedByName || 'خبير آخر'
      : null;
  return (
    <button type="button" className="desk-item review-queue__item" aria-current={selected} onClick={onSelect}>
      {diagnosis.imageUrl ? <img src={diagnosis.imageUrl} alt="" loading="lazy" /> : <span className="desk-muted" aria-label="لا توجد صورة">—</span>}
      <span className="review-queue__text">
        <span className="desk-item__top">
          <span className="desk-item__title">{diagnosis.farmerName || 'مزارع'}</span>
          <StatusChip status={diagnosis.status} />
        </span>
        <span className="desk-item__meta">
          {diagnosis.farmerRegion || 'منطقة غير محددة'} · {formatDate(diagnosis.createdAt)}
        </span>
        {heldBy ? <span className="desk-item__meta">يراجعها: {heldBy}</span> : null}
      </span>
    </button>
  );
};

const STATUS_CHIP_TONE = {
  amber: 'desk-chip--waiting',
  blue: 'desk-chip--active',
  green: 'desk-chip--done',
  red: 'desk-chip--closed',
};

const StatusChip = ({ status }) => {
  const meta = DIAGNOSIS_STATUS_META[status] ?? DIAGNOSIS_STATUS_META[DIAGNOSIS_STATUS.awaiting];
  return <span className={`desk-chip ${STATUS_CHIP_TONE[meta.tone] ?? ''}`}>{meta.label}</span>;
};

const buildEmptyReview = () => ({
  visibleParts: [],
  imageQuality: '',
  observations: [newObservation()],
  manualLabel: '',
  recommendedAction: '',
});

const buildReviewFromDiagnosis = (diagnosis = {}) => {
  const sourceObservations =
    Array.isArray(diagnosis.observations) && diagnosis.observations.length
      ? diagnosis.observations
      : Array.isArray(diagnosis.problems) && diagnosis.problems.length
        ? diagnosis.problems
        : [];
  const observations = sourceObservations.length
    ? sourceObservations.map((observation) => ({
        ...newObservation(),
        bodyPart: observation.bodyPart || diagnosis.bodyPart || 'leaf',
        ...observation,
      }))
    : [newObservation()];
  const visibleParts = uniqueStrings([
    ...(Array.isArray(diagnosis.visibleParts) ? diagnosis.visibleParts : []),
    ...observations.map((observation) => observation.bodyPart),
  ]);

  return {
    visibleParts,
    imageQuality: diagnosis.imageQuality || '',
    observations,
    manualLabel: diagnosis.manualLabel || '',
    recommendedAction: diagnosis.recommendedAction || '',
  };
};

const validateReview = (review = {}) => {
  const errors = [];
  if (!review.imageQuality) errors.push('اختر جودة الصورة قبل اعتماد النتيجة.');
  const observations = Array.isArray(review.observations) ? review.observations : [];
  if (!observations.length) errors.push('أضف ملاحظة تشخيصية واحدة على الأقل.');
  observations.forEach((observation, index) => {
    const prefix = `الملاحظة ${index + 1}:`;
    if (!observation.bodyPart) errors.push(`${prefix} اختر جزء النبات.`);
    if (!observation.problemType) errors.push(`${prefix} اختر المشكلة.`);
    if (observation.problemType === 'other' && !observation.manualLabel?.trim()) {
      errors.push(`${prefix} اكتب اسم المشكلة.`);
    }
    if (!observation.severity) errors.push(`${prefix} اختر الشدة.`);
    if (!observation.confidence) errors.push(`${prefix} اختر ثقة الخبير.`);
    if (!observation.spread) errors.push(`${prefix} اختر الانتشار.`);
  });
  return errors;
};

const isActiveStatus = (status) => status === DIAGNOSIS_STATUS.awaiting || status === DIAGNOSIS_STATUS.inReview;

const filterDiagnoses = (diagnoses, filters) => {
  const search = filters.search.trim().toLowerCase();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  return diagnoses.filter((diagnosis) => {
    if (filters.status === 'active') {
      if (!isActiveStatus(diagnosis.status)) return false;
    } else if (filters.status !== 'all' && diagnosis.status !== filters.status) {
      return false;
    }
    if (filters.region !== 'all' && diagnosis.farmerRegion !== filters.region) return false;
    const createdMs = timestampMs(diagnosis.createdAt);
    if (filters.date === 'today' && createdMs < startOfTodayMs()) return false;
    if (filters.date === 'week' && now - createdMs > 7 * dayMs) return false;
    if (!search) return true;
    return [diagnosis.farmerName, diagnosis.farmerPhone, diagnosis.farmerRegion]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
  });
};

const uniqueStrings = (values = []) =>
  Array.from(new Set(values.filter((value) => typeof value === 'string' && value.trim())));

// Waiting photos first, oldest first, so nobody waits longest by accident.
const statusRank = (status) => {
  if (status === DIAGNOSIS_STATUS.awaiting) return 0;
  if (status === DIAGNOSIS_STATUS.inReview) return 1;
  if (status === DIAGNOSIS_STATUS.rejected) return 2;
  return 3;
};

const startOfTodayMs = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const timestampMs = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  if (value.seconds) return value.seconds * 1000;
  return 0;
};

const formatDate = (value) => {
  const timestamp = timestampMs(value);
  if (!timestamp) return 'غير محدد';
  return new Date(timestamp).toLocaleString('ar-MA', { dateStyle: 'medium', timeStyle: 'short' });
};

export default VisionQueue;
