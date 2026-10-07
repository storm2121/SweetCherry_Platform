// Cherry-multiclass label constants.
//
// The actual strings shipped to the UI come from
// public/models/cherry_multiclass/labels.json (loaded by edgeInferenceService).
// This file mirrors those strings as named constants so components can
// branch on meaning (e.g., "should I paint the banner green or amber?")
// without hard-coding Arabic literals scattered across JSX.

export const HEALTHY_LABEL_AR = 'نبتة كرز سليمة';
export const POWDERY_MILDEW_LABEL_AR = 'كرز مصاب بالبياض الدقيقي';
export const BROWN_SPOT_LABEL_AR = 'كرز مصاب بالتبقع البني';
export const LEAF_SCORCH_LABEL_AR = 'كرز مصاب بحرق الأوراق';
export const PURPLE_LEAF_SPOT_LABEL_AR = 'كرز مصاب بالتبقع الأرجواني';
export const SHOT_HOLE_LABEL_AR = 'كرز مصاب بمرض ثقب الرصاص';

export const ALL_DISEASE_LABELS_AR = [
  POWDERY_MILDEW_LABEL_AR,
  BROWN_SPOT_LABEL_AR,
  LEAF_SCORCH_LABEL_AR,
  PURPLE_LEAF_SPOT_LABEL_AR,
  SHOT_HOLE_LABEL_AR,
];

export const isHealthy = (label = '') => label === HEALTHY_LABEL_AR;
