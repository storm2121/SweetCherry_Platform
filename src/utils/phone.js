// A phone number is the login: each one maps to the Firebase Auth email
// <digits>@sweetcherry.ma. Existing accounts were created with this mapping,
// so it must not change. Accounts with foreign numbers exist (the admin's is
// one), so nothing here may assume Morocco.

export const normalizePhone = (input = '') => {
  const digits = String(input).replace(/\D/g, '');
  // 00 is the international prefix, as + is. (Before this line, 00… became
  // +2120…; no live account has such a number.)
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('212')) return `+${digits}`;
  if (digits.startsWith('0')) return `+212${digits.slice(1)}`;
  if (digits.length === 9) return `+212${digits}`;
  return `+${digits}`;
};

export const phoneToEmail = (phone) => `${String(phone).replace(/\D/g, '')}@sweetcherry.ma`;

// Sign-in: anything that could be an existing account. The rules allow 6–15
// digits, so the login screen must not reject more than that.
export const isPlausiblePhone = (input = '') => {
  const value = String(input).trim();
  if (!/^\+?[\d\s().-]+$/.test(value)) return false;
  const digits = normalizePhone(value).length - 1;
  return digits >= 6 && digits <= 15;
};

// Registration: a Moroccan number (05, 06 or 07, with or without +212), or
// any other number written with its country code.
export const isValidNewPhone = (input = '') => {
  if (!isPlausiblePhone(input)) return false;
  const digits = normalizePhone(input).slice(1);
  if (digits.startsWith('212')) return /^212[5-7]\d{8}$/.test(digits);
  return digits.length >= 8;
};
