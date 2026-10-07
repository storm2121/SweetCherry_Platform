import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { useAuth } from '../../context/useAuth.js';
import { addPricePost, deletePricePost, subscribePricePosts } from '../../services/farmerService.js';
import { MARKET_LABELS } from '../../services/forecastService.js';

const GRADES = ['A', 'AA', 'AAA'];
const MARKETS = Object.entries(MARKET_LABELS);

const todayKey = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const dayFormat = new Intl.DateTimeFormat('ar-MA', { day: 'numeric', month: 'long', year: 'numeric' });

const reportDay = (post) => {
  if (post.date) return dayFormat.format(new Date(`${post.date}T12:00:00`));
  const ms = post.createdAt?.toMillis?.() ?? (post.createdAt?.seconds ? post.createdAt.seconds * 1000 : 0);
  return ms ? dayFormat.format(new Date(ms)) : '—';
};

const money = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('ar-MA', { maximumFractionDigits: 2 }) : '—';
};

// Farmers report the prices they see at market; the board shows them as
// reported, with the market and day, next to simple averages.
const PagePrices = () => {
  const { user } = useAuth();
  const fileRef = useRef(null);
  const [form, setForm] = useState({ quality: 'AA', market: 'M01', date: todayKey(), price: '' });
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loadError, setLoadError] = useState('');

  useEffect(
    () => subscribePricePosts(setPosts, () => setLoadError('تعذّر تحميل لوحة الأسعار. تحقق من الاتصال.')),
    [],
  );

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      await addPricePost({ farmer: user, ...form, imageFile: photo });
      setForm((current) => ({ ...current, price: '' }));
      setPhoto(null);
      setStatus({ tone: 'ready', text: 'أُضيف سعرك إلى اللوحة. شكراً لمشاركته.' });
    } catch (error) {
      setStatus({ tone: 'danger', text: error?.message || 'تعذّر حفظ السعر. حاول مرة أخرى.' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (post) => {
    if (!window.confirm('حذف هذا السعر من اللوحة؟')) return;
    try {
      await deletePricePost(post.id);
    } catch {
      setStatus({ tone: 'danger', text: 'تعذّر حذف السعر.' });
    }
  };

  // Averages by market and grade, only for reports that name their market.
  const averages = useMemo(() => {
    const groups = new Map();
    posts.forEach((post) => {
      const price = Number(post.price);
      if (!post.market || !Number.isFinite(price)) return;
      const key = `${post.market}|${post.quality}`;
      const group = groups.get(key) ?? { market: post.market, quality: post.quality, sum: 0, count: 0 };
      group.sum += price;
      group.count += 1;
      groups.set(key, group);
    });
    return Array.from(groups.values()).sort((a, b) =>
      a.market === b.market ? GRADES.indexOf(a.quality) - GRADES.indexOf(b.quality) : a.market.localeCompare(b.market),
    );
  }, [posts]);

  return (
    <section className="farm-page prices" aria-labelledby="prices-title">
      <header className="farm-page__intro">
        <h2 id="prices-title">أسعار الحقل</h2>
        <p>
          أسعار الكرز كما يبلّغ عنها المزارعون من الأسواق. لا يتحقق منها أحد، لكنها تُعرض على مخطط نطاقات
          الأسعار عندما يطابق السوق والدرجة واليوم.
        </p>
      </header>

      <div className="prices__layout">
        <form className="desk-surface prices__form" onSubmit={submit} aria-labelledby="report-title">
          <h3 id="report-title">أبلغ عن سعر رأيته</h3>

          <div className="review-choice" role="group" aria-label="درجة الجودة">
            <span className="review-choice__label">درجة الجودة</span>
            <div className="review-choice__options">
              {GRADES.map((grade) => (
                <button
                  key={grade}
                  type="button"
                  className="review-option"
                  aria-pressed={form.quality === grade}
                  onClick={() => update('quality', grade)}
                >
                  <bdi dir="ltr">{grade}</bdi>
                </button>
              ))}
            </div>
          </div>

          <div className="prices__row">
            <label className="desk-field">
              <span>السوق</span>
              <select className="desk-select" value={form.market} onChange={(event) => update('market', event.target.value)}>
                {MARKETS.map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </label>
            <label className="desk-field">
              <span>يوم السعر</span>
              <input
                className="desk-input"
                type="date"
                value={form.date}
                max={todayKey()}
                onChange={(event) => update('date', event.target.value)}
                required
              />
            </label>
          </div>

          <label className="desk-field">
            <span>السعر بالدرهم للكيلوغرام</span>
            <input
              className="desk-input prices__amount"
              type="number"
              inputMode="decimal"
              min="1"
              max="1000"
              step="0.5"
              value={form.price}
              onChange={(event) => update('price', event.target.value)}
              placeholder="مثال: 32"
              required
            />
          </label>

          <div className="prices__photo">
            {photo ? (
              <span className="desk-attachment">
                <span className="desk-attachment__file">{photo.name}</span>
                <button type="button" className="desk-button desk-button--quiet desk-button--danger" onClick={() => setPhoto(null)}>
                  إزالة
                </button>
              </span>
            ) : (
              <button type="button" className="desk-button" onClick={() => fileRef.current?.click()}>
                <Icon name="camera" size={18} />
                صورة للصناديق أو للوحة السعر (اختياري)
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                setPhoto(event.target.files?.[0] ?? null);
                event.target.value = '';
              }}
            />
          </div>

          <button type="submit" className="desk-button desk-button--primary" disabled={saving}>
            {saving ? 'جارٍ الحفظ…' : 'إضافة السعر'}
          </button>
          {status ? (
            <p className={`desk-notice desk-notice--${status.tone}`} role={status.tone === 'danger' ? 'alert' : 'status'}>
              {status.text}
            </p>
          ) : null}
        </form>

        <div className="prices__board">
          {loadError ? <p className="desk-notice desk-notice--danger" role="alert">{loadError}</p> : null}

          <section className="desk-surface" aria-labelledby="averages-title">
            <div className="desk-heading">
              <h3 id="averages-title">متوسط الأسعار المبلّغ عنها</h3>
              <p>حسب السوق والدرجة</p>
            </div>
            {averages.length ? (
              <table className="ws-table">
                <thead>
                  <tr>
                    <th scope="col">السوق</th>
                    <th scope="col">الدرجة</th>
                    <th scope="col">المتوسط (درهم/كغ)</th>
                    <th scope="col">عدد البلاغات</th>
                  </tr>
                </thead>
                <tbody>
                  {averages.map((row) => (
                    <tr key={`${row.market}-${row.quality}`}>
                      <td>{MARKET_LABELS[row.market] ?? row.market}</td>
                      <td><bdi dir="ltr">{row.quality}</bdi></td>
                      <td className="ws-num">{money(row.sum / row.count)}</td>
                      <td className="ws-num">{row.count.toLocaleString('ar-MA')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="desk-empty">لا توجد بلاغات تحدد السوق بعد.</p>
            )}
          </section>

          <section className="desk-surface" aria-labelledby="board-title">
            <div className="desk-heading">
              <h3 id="board-title">آخر البلاغات</h3>
              <p>{posts.length.toLocaleString('ar-MA')} بلاغ</p>
            </div>
            {posts.length ? (
              <div className="ws-table-wrap">
                <table className="ws-table">
                  <thead>
                    <tr>
                      <th scope="col">اليوم</th>
                      <th scope="col">السوق</th>
                      <th scope="col">الدرجة</th>
                      <th scope="col">السعر</th>
                      <th scope="col">المزارع</th>
                      <th scope="col"><span className="sr-only">إجراء</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {posts.map((post) => (
                      <tr key={post.id}>
                        <td>{reportDay(post)}</td>
                        <td>{MARKET_LABELS[post.market] ?? 'غير محدد'}</td>
                        <td><bdi dir="ltr">{post.quality || '—'}</bdi></td>
                        <td className="ws-num"><strong>{money(post.price)}</strong></td>
                        <td>
                          {post.farmerName || 'مزارع'}
                          <span className="ws-sub">{post.region || ''}</span>
                        </td>
                        <td>
                          {post.imageUrl ? (
                            <a className="desk-button desk-button--quiet" href={post.imageUrl} target="_blank" rel="noreferrer">
                              الصورة
                            </a>
                          ) : null}
                          {post.farmerId === user?.uid ? (
                            <button type="button" className="desk-button desk-button--quiet desk-button--danger" onClick={() => remove(post)}>
                              حذف
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="desk-empty">لا توجد أسعار مبلّغ عنها بعد.</p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
};

export default PagePrices;
