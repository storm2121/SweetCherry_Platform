/**
 * HydroponicsDashboard — full-screen page for IoT monitoring.
 *
 * Goals:
 *  • Real-time sensor readings from ESP32 (TDS, temperature, pump)
 *  • AI-powered plant deficiency detection (computer vision)
 *  • Resource tracking (cumulative water, nutrients)
 *  • Accessible, large-text UI for all ages
 *
 * Data flow:
 *  ESP32 → Cloud Function ingestSensorData → Firestore /hydroReadings/{deviceId}
 *  Dashboard subscribes via onSnapshot → live updates
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  analyzeVisionImage,
  getOrCreateDevice,
  resolveAlert,
  setPumpCommand,
  subscribeAlerts,
  subscribeReadings,
} from '../../services/hydroponicsService.js';

const HydroponicsDashboard = ({ onBack, userId }) => {
  const [device, setDevice] = useState(null);
  const [readings, setReadings] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loadingDevice, setLoadingDevice] = useState(true);

  // Init device
  useEffect(() => {
    if (!userId) return;
    getOrCreateDevice(userId)
      .then(setDevice)
      .catch(() => setDevice(null))
      .finally(() => setLoadingDevice(false));
  }, [userId]);

  // Subscribe to readings
  useEffect(() => {
    if (!device?.id) return;
    const unsub = subscribeReadings(device.id, setReadings);
    return () => unsub();
  }, [device?.id]);

  // Subscribe to alerts
  useEffect(() => {
    if (!device?.id) return;
    const unsub = subscribeAlerts(device.id, setAlerts);
    return () => unsub();
  }, [device?.id]);

  const deviceId = device?.id;
  const ownerId = userId;

  return (
    <main className="flex flex-col min-h-screen bg-[#FDFCF8]">
      {/* ── Header ── */}
      <header className="bg-gradient-to-br from-[#2C5F3F] to-[#3d8055] px-4 pt-8 pb-5 relative">
        <button
          className="absolute top-4 right-4 text-white/80 border border-white/25 rounded-full px-3 py-1.5 text-sm font-bold cursor-pointer bg-transparent hover:bg-white/10 transition-all duration-200"
          onClick={onBack}
          aria-label="العودة إلى لوحة المزارع"
        >
          ← رجوع
        </button>
        <div className="mt-2">
          <h1 className="font-[Fraunces] font-bold text-2xl text-white m-0">🌿 الزراعة المائية</h1>
          <p className="text-white/80 text-sm mt-1">مراقبة المستشعرات والمضخة وصحة النبات</p>
        </div>

        {/* Connection status pill */}
        <div className="mt-3 flex items-center gap-2">
          <ConnectionBadge readings={readings} />
        </div>
      </header>

      {loadingDevice ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[#78786C] text-sm">جاري تحضير الجهاز...</p>
        </div>
      ) : (
        <div className="flex-1 px-4 py-4 flex flex-col gap-4 pb-8">

          {/* ── Device ID Card ── */}
          <DeviceIdCard deviceId={deviceId} />

          {/* ── Sensor Readings ── */}
          <SensorPanel readings={readings} />

          {/* ── Pump Control ── */}
          <PumpPanel deviceId={deviceId} readings={readings} />

          {/* ── Resource Tracker ── */}
          <ResourcePanel readings={readings} />

          {/* ── Plant Vision ── */}
          <VisionPanel deviceId={deviceId} ownerId={ownerId} alerts={alerts} onResolve={resolveAlert} />

          {/* ── Setup Guide ── */}
          <SetupGuide deviceId={deviceId} />
        </div>
      )}
    </main>
  );
};

export default HydroponicsDashboard;

// ─────────────────────────────────────────────────────────────────────────────
// Sub-panels
// ─────────────────────────────────────────────────────────────────────────────

const ConnectionBadge = ({ readings }) => {
  const isLive = readings?.timestamp && Date.now() - readings.timestamp < 2 * 60 * 1000;
  return (
    <span
      className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full ${
        isLive ? 'bg-[#5D7052]/20 text-white' : 'bg-white/10 text-white/60'
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : 'bg-white/40'}`}
        aria-hidden="true"
      />
      {isLive ? 'متصل' : 'غير متصل'}
    </span>
  );
};

// ─── Device ID card ───────────────────────────────────────────────────────────

const DeviceIdCard = ({ deviceId }) => (
  <section className="bg-[#FEFEFA] rounded-[1.5rem] p-4 border border-[#DED8CF]/30 shadow-[0_2px_12px_-2px_rgba(93,112,82,0.08)]">
    <h2 className="font-[Fraunces] font-bold text-base text-[#2C2C24] mb-1">🔑 معرّف الجهاز</h2>
    <p className="text-[#78786C] text-xs mb-2">
      أدخل هذا المعرّف في كود Arduino الخاص بجهاز ESP32 ليبدأ الإرسال تلقائياً.
    </p>
    <div className="bg-[#2C2C24] rounded-[0.75rem] px-4 py-3 flex items-center justify-between gap-2">
      <span className="text-[#F3F4F1] font-mono text-sm break-all">{deviceId ?? '...'}</span>
      <CopyButton text={deviceId ?? ''} />
    </div>
  </section>
);

const CopyButton = ({ text }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="shrink-0 text-xs text-[#C18C5D] font-bold cursor-pointer bg-transparent border-none"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      aria-label="نسخ معرّف الجهاز"
    >
      {copied ? '✓ تم' : 'نسخ'}
    </button>
  );
};

// ─── Sensor readings ──────────────────────────────────────────────────────────

const TDS_RANGES = [
  { max: 400, label: 'منخفض جداً', color: '#A85448' },
  { max: 700, label: 'منخفض', color: '#C18C5D' },
  { max: 1200, label: 'مثالي', color: '#5D7052' },
  { max: 1600, label: 'مرتفع', color: '#C18C5D' },
  { max: Infinity, label: 'مرتفع جداً', color: '#A85448' },
];

const getTdsStatus = (tds) => TDS_RANGES.find((r) => tds <= r.max) ?? TDS_RANGES.at(-1);

const SensorPanel = ({ readings }) => {
  const tds = readings?.tds ?? null;
  const temp = readings?.temperature ?? null;
  const tdsStatus = tds !== null ? getTdsStatus(tds) : null;
  const tsLabel = readings?.timestamp
    ? new Date(readings.timestamp).toLocaleTimeString('ar-MA')
    : null;

  return (
    <section aria-label="قراءات المستشعرات">
      <div className="flex justify-between items-center mb-2 px-1">
        <h2 className="font-[Fraunces] font-bold text-base text-[#2C2C24]">📡 قراءات المستشعرات</h2>
        {tsLabel ? <span className="text-[#78786C] text-xs">{tsLabel}</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {/* TDS */}
        <SensorCard
          icon="💧"
          label="TDS — المغذيات"
          value={tds !== null ? `${tds}` : '—'}
          unit="ppm"
          status={tdsStatus?.label ?? 'في انتظار البيانات'}
          statusColor={tdsStatus?.color ?? '#78786C'}
          subInfo="المثالي: 700–1200 ppm"
        />
        {/* Temperature */}
        <SensorCard
          icon="🌡️"
          label="درجة حرارة الماء"
          value={temp !== null ? `${temp.toFixed(1)}` : '—'}
          unit="°م"
          status={temp !== null ? tempStatus(temp) : 'في انتظار البيانات'}
          statusColor={temp !== null ? tempColor(temp) : '#78786C'}
          subInfo="المثالي: 18–24 °م"
        />
      </div>
      {!readings ? (
        <p className="text-[#78786C] text-xs text-center mt-2">
          لم تصل بيانات بعد — تأكد من توصيل الجهاز.
        </p>
      ) : null}
    </section>
  );
};

const SensorCard = ({ icon, label, value, unit, status, statusColor, subInfo }) => (
  <article className="bg-[#FEFEFA] rounded-[1.5rem] p-4 border border-[#DED8CF]/30 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-1">
    <span className="text-2xl leading-none mb-0.5" aria-hidden="true">{icon}</span>
    <span className="text-[#78786C] text-xs font-bold">{label}</span>
    <div className="flex items-end gap-1 mt-1">
      <span className="font-[Fraunces] font-bold text-3xl text-[#2C2C24] leading-none">{value}</span>
      <span className="text-[#78786C] text-sm mb-0.5">{unit}</span>
    </div>
    <span className="text-xs font-bold mt-1" style={{ color: statusColor }}>{status}</span>
    <span className="text-[#78786C] text-[10px]">{subInfo}</span>
  </article>
);

const tempStatus = (t) => {
  if (t < 15) return 'بارد جداً';
  if (t < 18) return 'بارد';
  if (t <= 24) return 'مثالي';
  if (t <= 28) return 'دافئ';
  return 'حار جداً';
};

const tempColor = (t) => {
  if (t < 15 || t > 28) return '#A85448';
  if (t < 18 || t > 24) return '#C18C5D';
  return '#5D7052';
};

// ─── Pump control ─────────────────────────────────────────────────────────────

const PumpPanel = ({ deviceId, readings }) => {
  const [working, setWorking] = useState(false);
  const pumpOn = readings?.pumpOn ?? false;

  const toggle = async () => {
    if (!deviceId || working) return;
    setWorking(true);
    try {
      await setPumpCommand(deviceId, !pumpOn);
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="bg-[#FEFEFA] rounded-[1.5rem] p-4 border border-[#DED8CF]/30 shadow-[0_2px_12px_-2px_rgba(93,112,82,0.08)]">
      <h2 className="font-[Fraunces] font-bold text-base text-[#2C2C24] mb-3">⚙️ التحكم في المضخة</h2>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[#2C2C24] font-bold text-lg">
            المضخة:{' '}
            <span className={pumpOn ? 'text-[#5D7052]' : 'text-[#78786C]'}>
              {pumpOn ? 'تعمل' : 'متوقفة'}
            </span>
          </p>
          <p className="text-[#78786C] text-xs">
            {pumpOn ? 'الماء يتدفق إلى الجذور.' : 'يمكنك تشغيل المضخة يدوياً.'}
          </p>
        </div>
        <button
          className={`w-16 h-16 rounded-full border-none cursor-pointer font-bold text-xl shadow-md transition-all duration-300 shrink-0 ${
            pumpOn
              ? 'bg-[#5D7052] text-white shadow-[0_4px_12px_rgba(93,112,82,0.4)]'
              : 'bg-[#F0EBE5] text-[#78786C]'
          } ${working ? 'opacity-60 cursor-not-allowed' : 'hover:scale-105 active:scale-95'}`}
          onClick={toggle}
          disabled={working || !deviceId}
          aria-label={pumpOn ? 'إيقاف المضخة' : 'تشغيل المضخة'}
          aria-pressed={pumpOn}
        >
          {working ? '...' : pumpOn ? '⏹' : '▶'}
        </button>
      </div>
      <p className="text-[#78786C] text-xs mt-3 bg-[#F0EBE5] rounded-xl p-2.5">
        💡 يُرسَل الأمر إلى جهاز ESP32 عبر الإنترنت — يُنفَّذ خلال ثوانٍ.
      </p>
    </section>
  );
};

// ─── Resource tracker ─────────────────────────────────────────────────────────

const ResourcePanel = ({ readings }) => {
  const waterSaved = readings?.cumulativeWaterSavedL ?? null;
  const nutrientDelivered = readings?.cumulativeNutrientMl ?? null;
  const uptimeDays = readings?.uptimeDays ?? null;

  return (
    <section className="bg-[#FEFEFA] rounded-[1.5rem] p-4 border border-[#DED8CF]/30 shadow-[0_2px_12px_-2px_rgba(93,112,82,0.08)]">
      <h2 className="font-[Fraunces] font-bold text-base text-[#2C2C24] mb-3">📊 تتبع الموارد</h2>
      <div className="grid grid-cols-3 gap-2">
        <ResourceStat label="ماء موفّر" value={waterSaved !== null ? `${waterSaved.toFixed(0)}L` : '—'} icon="💧" color="#5D7052" />
        <ResourceStat label="مغذيات ضُخَّت" value={nutrientDelivered !== null ? `${nutrientDelivered.toFixed(0)}ml` : '—'} icon="🧪" color="#C18C5D" />
        <ResourceStat label="أيام التشغيل" value={uptimeDays !== null ? `${uptimeDays}` : '—'} icon="📅" color="#2C2C24" />
      </div>
      {waterSaved === null ? (
        <p className="text-[#78786C] text-xs text-center mt-2">
          ستظهر الإحصاءات بعد بدء إرسال بيانات الجهاز.
        </p>
      ) : null}
    </section>
  );
};

const ResourceStat = ({ label, value, icon, color }) => (
  <div className="bg-[#FDFCF8] rounded-[1rem] p-3 border border-[#DED8CF]/25 text-center">
    <span className="text-xl" aria-hidden="true">{icon}</span>
    <div className="font-[Fraunces] font-bold text-xl mt-1" style={{ color }}>{value}</div>
    <div className="text-[#78786C] text-[10px] mt-0.5 leading-tight">{label}</div>
  </div>
);

// ─── Plant Vision panel ───────────────────────────────────────────────────────

const VisionPanel = ({ deviceId, ownerId, alerts, onResolve }) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const fileRef = useRef(null);

  const handleImageSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !deviceId) return;
    setAnalyzing(true);
    setErrorMsg('');
    setAnalysisResult(null);
    try {
      const result = await analyzeVisionImage(deviceId, ownerId, file);
      setAnalysisResult(result);
    } catch (err) {
      setErrorMsg(err.message || 'فشل تحليل الصورة.');
    } finally {
      setAnalyzing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [deviceId, ownerId]);

  const openAlerts = alerts.filter((a) => a.status !== 'resolved');

  return (
    <section className="bg-[#FEFEFA] rounded-[1.5rem] p-4 border border-[#DED8CF]/30 shadow-[0_2px_12px_-2px_rgba(93,112,82,0.08)]">
      <h2 className="font-[Fraunces] font-bold text-base text-[#2C2C24] mb-1">🔬 تحليل صحة النبات بالذكاء الاصطناعي</h2>
      <p className="text-[#78786C] text-xs mb-3">
        التقط صورة لأوراق النبات وسيحلل النظام نقص العناصر الغذائية (البوتاسيوم، النيتروجين، إلخ.).
      </p>

      {/* Upload button */}
      <label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleImageSelect}
          disabled={analyzing}
        />
        <button
          className={`w-full py-3.5 rounded-[1.25rem] font-bold text-base border-none cursor-pointer transition-all duration-300 ${
            analyzing
              ? 'bg-[#DED8CF] text-[#78786C] cursor-not-allowed'
              : 'bg-gradient-to-br from-[#2C5F3F] to-[#3d8055] text-white shadow-[0_4px_16px_-2px_rgba(44,95,63,0.3)] hover:scale-[1.02] active:scale-[0.98]'
          }`}
          type="button"
          onClick={() => !analyzing && fileRef.current?.click()}
          aria-label="التقاط أو رفع صورة النبات للتحليل"
        >
          {analyzing ? '⏳ جاري التحليل...' : '📸 التقط صورة للتحليل'}
        </button>
      </label>

      {/* Analysis result */}
      {analysisResult ? (
        <div className="mt-3 bg-[rgba(93,112,82,0.08)] rounded-[1.25rem] p-3.5">
          <p className="font-bold text-sm text-[#2C2C24] mb-1">نتيجة التحليل:</p>
          <p className="text-sm text-[#2C2C24]">{analysisResult.message || 'تم التحليل بنجاح.'}</p>
          {analysisResult.deficiency ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[#A85448] font-bold text-sm">⚠️ نقص محتمل: {analysisResult.deficiency}</span>
              <span className="text-xs text-[#78786C]">({Math.round((analysisResult.confidence ?? 0) * 100)}%)</span>
            </div>
          ) : null}
          {analysisResult.recommendation ? (
            <p className="mt-2 text-sm text-[#5D7052]">
              💡 التوصية: {analysisResult.recommendation}
            </p>
          ) : null}
        </div>
      ) : null}

      {errorMsg ? (
        <p className="mt-2 text-[#A85448] text-sm">{errorMsg}</p>
      ) : null}

      {/* Historical alerts */}
      {openAlerts.length > 0 ? (
        <div className="mt-4">
          <p className="font-bold text-sm text-[#2C2C24] mb-2">تنبيهات سابقة:</p>
          <div className="flex flex-col gap-2">
            {openAlerts.slice(0, 3).map((alert) => (
              <div
                key={alert.id}
                className="bg-[#A85448]/6 border border-[#A85448]/20 rounded-[1rem] p-3 flex items-start justify-between gap-2"
              >
                <div className="flex-1">
                  <p className="text-sm font-bold text-[#A85448]">{alert.type ?? 'تنبيه'}</p>
                  <p className="text-xs text-[#78786C] mt-0.5">{alert.message}</p>
                </div>
                <button
                  className="text-xs text-[#5D7052] font-bold cursor-pointer bg-transparent border-none shrink-0"
                  onClick={() => onResolve(alert.id)}
                  aria-label="تعليم التنبيه كمُعالَج"
                >
                  تم
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
};

// ─── Setup guide ──────────────────────────────────────────────────────────────

const SetupGuide = ({ deviceId }) => (
  <section className="bg-[rgba(193,140,93,0.08)] rounded-[1.5rem] p-4 border border-[#C18C5D]/20">
    <h2 className="font-[Fraunces] font-bold text-base text-[#2C2C24] mb-2">🔧 دليل الإعداد — ESP32</h2>
    <ol className="flex flex-col gap-2 text-sm text-[#2C2C24] list-decimal list-inside">
      <li>قم بتحميل مكتبات <strong>OneWire</strong>، <strong>DallasTemperature</strong>، و<strong>ArduinoJson</strong> في Arduino IDE.</li>
      <li>وصّل المكونات: TDS sensor (PIN 34) ← ADC | DS18B20 (PIN 4) ← OneWire | PN2222 Base (PIN 26) ← Pump relay.</li>
      <li>أدخل معرّف جهازك <code className="bg-white/60 rounded px-1 py-0.5 text-xs font-mono">{deviceId ?? '...'}</code> في المتغير <code className="bg-white/60 rounded px-1 text-xs font-mono">DEVICE_ID</code> بكود Arduino.</li>
      <li>أدخل رابط Cloud Function الخاص بك في المتغير <code className="bg-white/60 rounded px-1 text-xs font-mono">API_URL</code>.</li>
      <li>اشحن الكود وراقب الإشارة الخضراء "متصل" أعلاه.</li>
    </ol>
    <p className="text-[#78786C] text-xs mt-3">
      كود Arduino كامل متاح في مجلد <code className="bg-white/40 rounded px-1 text-xs font-mono">esp32/sketch.ino</code> بمستودع المشروع.
    </p>
  </section>
);
