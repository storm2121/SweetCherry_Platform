export const contextTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return contextTimestamp(value.toDate());
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
};

export const contextDate = (value, dateOnly = false) => {
  const timestamp = contextTimestamp(value);
  if (!timestamp) return 'غير محدد';
  return new Intl.DateTimeFormat('ar-MA', {
    timeZone: 'Africa/Casablanca',
    dateStyle: 'medium',
    ...(dateOnly ? {} : { timeStyle: 'short' }),
  }).format(timestamp);
};

export const contextNumber = (value, unit = '', digits = 1) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const display = new Intl.NumberFormat('ar-MA', { maximumFractionDigits: digits }).format(number);
  return unit ? display + ' ' + unit : display;
};

export const contextSource = (source) => {
  const labels = {
    weatherapi: 'WeatherAPI',
    'open-meteo': 'Open-Meteo',
    sample: 'بيانات توضيحية',
    'legacy-snapshot': 'بيانات محفوظة غير متحقق منها',
  };
  return labels[source] || 'مصدر غير محدد';
};

export const climatePeriod = (window) => {
  if (!window?.startDate || !window?.endDate) return 'فترة الرصد غير محددة';
  const dates = contextDate(window.startDate, true) + ' إلى ' + contextDate(window.endDate, true);
  return window.period === '7_completed_days' ? 'سبعة أيام مكتملة: ' + dates : dates;
};

export const weatherGuidance = (weather = {}, loading = false) => {
  if (loading) return {
    title: 'ننتظر تحديث الطقس',
    message: 'ستظهر المؤشرات بعد وصول بيانات المنطقة.',
    tone: 'loading',
  };
  if (weather.risk === 'Heat risk' || weather.riskLabel === 'خطر الحرارة') return {
    title: 'خطر الحرارة',
    message: 'تُظهر التوقعات حرارة مرتفعة. راجع توقيت العمل والري مع الخبير، وتابع حالة الأشجار.',
    tone: 'warning',
  };
  if (weather.risk === 'Frost risk' || weather.riskLabel === 'خطر الصقيع') return {
    title: 'خطر الصقيع',
    message: 'تُظهر التوقعات انخفاضاً في الحرارة. راجع خطة الحماية مع الخبير بحسب مرحلة نمو الأشجار.',
    tone: 'danger',
  };
  if (weather.risk === 'Rain risk' || weather.riskLabel === 'خطر الأمطار') return {
    title: 'احتمال أمطار',
    message: 'راجع توقيت الرش والعمل في الحقل على ضوء توقعات الأمطار وتوجيهات الخبير.',
    tone: 'warning',
  };
  if (weather.risk === 'Stable' && weather.dataStatus === 'live') return {
    title: 'الظروف مستقرة وفق المؤشرات المتاحة',
    message: 'لم تتجاوز التوقعات عتبات الحرارة والصقيع والأمطار المعتمدة. حدّد أعمال الحقل بحسب حالة مزرعتك وتوجيهات الخبير.',
    tone: 'ready',
  };
  return {
    title: 'لا يتوفر تقييم للطقس',
    message: 'البيانات الحالية لا تكفي لتقييم المخاطر. لن تُعرض توصية ميدانية على أساس بيانات ناقصة.',
    tone: 'loading',
  };
};

