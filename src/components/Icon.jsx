const paths = {
  arrow: <path d="M19 12H5m7-7-7 7 7 7" />,
  weather: <><path d="M7 16a4 4 0 1 1 1-7 5 5 0 0 1 9 3 3 3 0 0 1 0 6H7" /><path d="M17 2v2m4 3h2M4 5 2 3" /></>,
  chart: <path d="M4 3v17h17M7 14l4-5 4 3 6-7" />,
  leaf: <><path d="M20 3C9 2 3 6 4 13c1 7 12 8 16-10Z" /><path d="M4 21 16 9" /></>,
  map: <path d="m3 5 6-2 6 3 6-2v15l-6 2-6-3-6 2V5Zm6-2v15m6-12v15" />,
  chat: <><path d="M21 12a9 9 0 0 1-9 9c-2 0-4-.5-5.5-1.5L3 21l1.5-3.5A9 9 0 1 1 21 12Z" /><path d="M8 12h8m-8-4h5" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 6-6 4 4 3-3 5 5" /></>,
  speaker: <path d="m11 4-6 5H2v6h3l6 5V4Zm5 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="1" />,
  user: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  camera: <><path d="M3 7h4l2-3h6l2 3h4v13H3V7Z" /><circle cx="12" cy="13" r="4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v1" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  warning: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5m0 3v1" /></>,
  location: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
};
const Icon = ({ name, size = 22, className = '' }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{paths[name] || paths.info}</svg>;
export default Icon;
