import { timestampMs } from '../../services/expertRequestService.js';

const dateTime = new Intl.DateTimeFormat('ar-MA', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

const timeOnly = new Intl.DateTimeFormat('ar-MA', { hour: '2-digit', minute: '2-digit' });

// "اليوم 14:05", "أمس 09:30", or "3 أكتوبر 18:20".
export const formatWhen = (value) => {
  const ms = timestampMs(value);
  if (!ms) return 'الآن';
  const date = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return `اليوم ${timeOnly.format(date)}`;
  if (date.toDateString() === yesterday.toDateString()) return `أمس ${timeOnly.format(date)}`;
  return dateTime.format(date);
};

export const contentLabel = (item = {}) => {
  if (item.type === 'image') return item.body ? `صورة: ${item.body}` : 'صورة';
  if (item.type === 'audio') return item.body ? `تسجيل صوتي: ${item.body}` : 'تسجيل صوتي';
  return item.body || '';
};
