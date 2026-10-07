export const VISION_DIAGNOSES = 'visionDiagnoses';

export const DIAGNOSIS_STATUS = {
  awaiting: 'awaiting_expert',
  inReview: 'in_review',
  reviewed: 'reviewed',
  rejected: 'rejected',
};

export const DIAGNOSIS_STATUS_META = {
  [DIAGNOSIS_STATUS.awaiting]: {
    label: 'في انتظار رد الخبير',
    tone: 'amber',
  },
  [DIAGNOSIS_STATUS.inReview]: {
    label: 'قيد المراجعة',
    tone: 'blue',
  },
  [DIAGNOSIS_STATUS.reviewed]: {
    label: 'تمت المراجعة',
    tone: 'green',
  },
  [DIAGNOSIS_STATUS.rejected]: {
    label: 'الصورة غير صالحة',
    tone: 'red',
  },
};

export const BODY_PART_OPTIONS = [
  { value: 'leaf', label: 'ورقة' },
  { value: 'fruit', label: 'ثمرة' },
  { value: 'flower', label: 'زهرة' },
  { value: 'bud', label: 'برعم' },
  { value: 'branch', label: 'غصن' },
  { value: 'trunk', label: 'جذع' },
  { value: 'canopy', label: 'المجموع الخضري' },
  { value: 'root', label: 'جذر' },
  { value: 'other', label: 'جزء آخر' },
];

export const IMAGE_QUALITY_OPTIONS = [
  { value: 'good', label: 'واضحة وجيدة' },
  { value: 'blurry', label: 'ضبابية' },
  { value: 'too_far', label: 'بعيدة جداً' },
  { value: 'bad_light', label: 'إضاءة ضعيفة' },
  { value: 'incomplete', label: 'الجزء المصاب غير كامل' },
  { value: 'unusable', label: 'غير صالحة للتشخيص' },
];

export const PROBLEM_OPTIONS = [
  { value: 'healthy', label: 'سليمة' },
  { value: 'powdery_mildew', label: 'البياض الدقيقي' },
  { value: 'brown_spot', label: 'التبقع البني' },
  { value: 'leaf_scorch', label: 'حرق الأوراق' },
  { value: 'purple_leaf_spot', label: 'التبقع الأرجواني' },
  { value: 'shot_hole', label: 'مرض ثقب الرصاص' },
  { value: 'fruit_cracking', label: 'تشقق الثمار' },
  { value: 'brown_rot', label: 'العفن البني' },
  { value: 'pest_damage', label: 'ضرر حشري' },
  { value: 'nutrient_deficiency', label: 'نقص غذائي' },
  { value: 'water_stress', label: 'إجهاد مائي' },
  { value: 'heat_frost_damage', label: 'ضرر حرارة أو صقيع' },
  { value: 'unknown_needs_more_info', label: 'غير واضح / يحتاج معلومات أكثر' },
  { value: 'other', label: 'مشكلة أخرى' },
];

export const SEVERITY_OPTIONS = [
  { value: 'none', label: 'لا توجد إصابة' },
  { value: 'mild', label: 'خفيفة' },
  { value: 'moderate', label: 'متوسطة' },
  { value: 'severe', label: 'شديدة' },
  { value: 'critical', label: 'حرجة' },
];

export const CONFIDENCE_OPTIONS = [
  { value: 'low', label: 'ثقة منخفضة' },
  { value: 'medium', label: 'ثقة متوسطة' },
  { value: 'high', label: 'ثقة عالية' },
];

export const SPREAD_OPTIONS = [
  { value: 'single_spot', label: 'بقعة واحدة' },
  { value: 'few_spots', label: 'بقع قليلة' },
  { value: 'many_spots', label: 'بقع كثيرة' },
  { value: 'whole_part', label: 'معظم الجزء مصاب' },
  { value: 'whole_tree', label: 'قد تكون على كامل الشجرة' },
];

export const SYMPTOM_OPTIONS = [
  { value: 'white_powder', label: 'مسحوق أبيض' },
  { value: 'brown_spots', label: 'بقع بنية' },
  { value: 'purple_spots', label: 'بقع أرجوانية' },
  { value: 'holes', label: 'ثقوب في الورقة' },
  { value: 'yellowing', label: 'اصفرار' },
  { value: 'burnt_edges', label: 'احتراق الحواف' },
  { value: 'wilting', label: 'ذبول' },
  { value: 'curling', label: 'التفاف الأوراق' },
  { value: 'insects_visible', label: 'حشرات ظاهرة' },
  { value: 'fruit_cracks', label: 'تشققات في الثمار' },
  { value: 'oozing', label: 'إفرازات أو صمغ' },
];

export const optionLabel = (options, value, fallback = 'غير محدد') =>
  options.find((option) => option.value === value)?.label ?? fallback;
