import '../styles/brand.css';

// The tagline follows the page language; it is set apart with dir="auto" so
// an Arabic tagline aligns right and a French or English one aligns left.
const Brand = ({ compact = false, inverse = false, tagline = 'من الحقل إلى القرار' }) => (
  <span className={`sc-brand${inverse ? ' sc-brand--inverse' : ''}`} dir="ltr">
    <svg width="30" height="36" viewBox="0 0 30 36" fill="none" aria-hidden="true">
      <path d="M9 19C10 10 15 7 21 3M22 23C22 12 20 6 21 3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M20 6C13 6 12 2 12 2C18 1 22 3 20 6Z" fill="currentColor" />
      <circle cx="8" cy="25" r="6.5" fill="currentColor" />
      <circle cx="23" cy="29" r="6.5" fill="currentColor" />
    </svg>
    <span>SweetCherry{!compact && <small dir="auto">{tagline}</small>}</span>
  </span>
);

export default Brand;
