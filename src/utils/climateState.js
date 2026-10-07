const validTimestamp = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

export const climateDataState = (raw = {}, fallback = false) => {
  const sample = fallback || raw.isSample === true;
  return {
    ...raw,
    source: sample ? 'sample' : raw.source || 'legacy-snapshot',
    asOf: sample ? null : validTimestamp(raw.asOf) || validTimestamp(raw.generatedAt),
    isSample: sample ? true : raw.isSample === false ? false : null,
    dataStatus: sample ? 'sample' : raw.dataStatus || (raw.isSample === false ? 'available' : 'unverified'),
    warning: sample ? 'تعذر تحميل البيانات الحالية. المعروض بيانات توضيحية ولا يستخدم لاتخاذ قرار.'
      : raw.warning || (!raw.source ? 'مصدر هذه البيانات وتاريخ رصدها يحتاجان إلى تحقق.' : null),
  };
};
