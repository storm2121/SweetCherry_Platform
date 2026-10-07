import { useEffect, useId, useRef, useState } from 'react';
import { monthStarts, niceScale, seriesEnd } from '../../utils/landingForecast.js';
import { formatDay, formatNumber } from './format.js';

const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);

const useWidth = (ref) => {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => setWidth(Math.round(node.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
};

// Weekly P10–P90 band with the P50 line. Weeks before today are grey so the
// reader can see which part of the forecast is still ahead. Drawn at the real
// pixel width so labels keep their size on a phone.
const PriceBandChart = ({ series, today, lang, unit, todayLabel, summary }) => {
  const frameRef = useRef(null);
  const width = useWidth(frameRef);
  const clipId = `lp-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const height = width && width < 520 ? 240 : 290;

  let chart = null;
  if (width && series.length > 1) {
    const pad = { top: 34, right: 12, bottom: 46, left: 44 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const start = toMs(series[0].date);
    const end = toMs(series[series.length - 1].date);
    const lows = series.map((row) => row.low ?? row.expected);
    const highs = series.map((row) => row.high ?? row.expected);
    const scale = niceScale(Math.min(...lows), Math.max(...highs), 4);
    const x = (ms) => pad.left + ((ms - start) / (end - start)) * plotW;
    const y = (value) => pad.top + ((scale.hi - value) / (scale.hi - scale.lo)) * plotH;

    const points = series.map((row, index) => ({
      x: x(toMs(row.date)), low: y(lows[index]), mid: y(row.expected), high: y(highs[index]),
    }));
    const band = `M${points.map((p) => `${p.x},${p.high}`).join('L')}L${points
      .slice()
      .reverse()
      .map((p) => `${p.x},${p.low}`)
      .join('L')}Z`;
    const line = `M${points.map((p) => `${p.x},${p.mid}`).join('L')}`;

    const now = toMs(today);
    const split = Math.min(Math.max(x(now), pad.left), pad.left + plotW);
    const showToday = now >= start && now < toMs(seriesEnd(series));

    const months = monthStarts(series[0].date, series[series.length - 1].date);
    const labelEvery = Math.max(1, Math.ceil((lang === 'ar' ? 58 : 40) / (plotW / Math.max(months.length, 1))));

    chart = (
      <svg width={width} height={height} role="img" aria-label={summary} className="lp-chart__svg">
        <defs>
          <clipPath id={`${clipId}-past`}>
            <rect x="0" y="0" width={split} height={height} />
          </clipPath>
          <clipPath id={`${clipId}-ahead`}>
            <rect x={split} y="0" width={Math.max(width - split, 0)} height={height} />
          </clipPath>
        </defs>

        <text className="lp-chart__unit" x={pad.left} y="14" textAnchor="start">{unit}</text>
        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line className="lp-chart__grid" x1={pad.left} x2={pad.left + plotW} y1={y(tick)} y2={y(tick)} />
            <text className="lp-chart__tick" x={pad.left - 10} y={y(tick)} dy="0.35em" textAnchor="end">
              {formatNumber(tick, lang)}
            </text>
          </g>
        ))}

        {months.map((iso, index) => {
          const tx = x(toMs(iso));
          const labelled = index % labelEvery === 0;
          const withYear = index === 0 || iso.endsWith('-01-01');
          return (
            <g key={iso}>
              <line className="lp-chart__axis" x1={tx} x2={tx} y1={pad.top + plotH} y2={pad.top + plotH + 5} />
              {labelled ? (
                <text className="lp-chart__tick" x={tx} y={pad.top + plotH + 19} textAnchor="middle">
                  {formatDay(iso, lang, { month: lang === 'ar' ? 'long' : 'short' })}
                </text>
              ) : null}
              {labelled && withYear ? (
                <text className="lp-chart__year" x={tx} y={pad.top + plotH + 35} textAnchor="middle">
                  {iso.slice(0, 4)}
                </text>
              ) : null}
            </g>
          );
        })}
        <line className="lp-chart__axis" x1={pad.left} x2={pad.left + plotW} y1={pad.top + plotH} y2={pad.top + plotH} />

        <g clipPath={`url(#${clipId}-past)`}>
          <path className="lp-chart__band lp-chart__band--past" d={band} />
          <path className="lp-chart__line lp-chart__line--past" d={line} />
        </g>
        <g clipPath={`url(#${clipId}-ahead)`}>
          <path className="lp-chart__band" d={band} />
          <path className="lp-chart__line" d={line} />
        </g>

        {showToday ? (
          <g>
            <line className="lp-chart__today" x1={split} x2={split} y1={pad.top - 6} y2={pad.top + plotH} />
            <text
              className="lp-chart__today-label"
              x={split}
              y={pad.top - 12}
              textAnchor={split > pad.left + plotW - 30 ? 'end' : split < pad.left + 30 ? 'start' : 'middle'}
            >
              {todayLabel}
            </text>
          </g>
        ) : null}
      </svg>
    );
  }

  return (
    <div ref={frameRef} className="lp-chart" style={{ minHeight: height || 290 }}>
      {chart}
    </div>
  );
};

export default PriceBandChart;
