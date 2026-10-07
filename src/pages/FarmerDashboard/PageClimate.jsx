import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useClimateData } from '../../hooks/useClimateData.js';
import { fetchRegionClimate } from '../../services/climateService.js';
import { climatePeriod, contextDate, contextNumber, contextSource } from '../../utils/fieldPresentation.js';
import '../../styles/field-context.css';

const MAP_STYLE = 'mapbox://styles/mapbox/light-v11';
const LAYER_CONFIGS = [
  { id: 'temperature', label: 'الحرارة', color: '#b87645' },
  { id: 'rainfall', label: 'الهطول', color: '#557a8d' },
  { id: 'chillHours', label: 'تراكم البرودة خلال الفترة', color: '#766c96' },
  { id: 'drought', label: 'إشارة نقص الهطول', color: '#a56068' },
];
const VIABILITY_SOURCE = 'study-region-source';
const VIABILITY_LAYER = 'study-region-layer';
const INITIAL_LAYERS = { temperature: true, rainfall: true, chillHours: false, drought: false, viability: true };

const PageClimate = () => {
  const mapNodeRef = useRef(null);
  const mapRef = useRef(null);
  const requestRef = useRef(0);
  const [activeLayers, setActiveLayers] = useState(INITIAL_LAYERS);
  const [scenario, setScenario] = useState('current');
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [mapError, setMapError] = useState(false);
  const { payload, loading, error, warning, source, asOf, isSample, dataStatus } = useClimateData();
  const mapToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
  const scenarios = useMemo(() => Object.keys(payload?.layers?.viability || {}), [payload]);
  const activeScenario = scenarios.includes(scenario) ? scenario : scenarios[0] || 'current';
  const mapStateRef = useRef({ activeLayers: INITIAL_LAYERS, scenario: 'current' });

  const loadSummary = useCallback(async (regionId) => {
    if (!regionId) return;
    const request = ++requestRef.current;
    setSelectedRegion(regionId);
    setSummary(null);
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const information = await fetchRegionClimate(regionId);
      if (request !== requestRef.current) return;
      setSummary(information);
      if (!information) setSummaryError('لا تتوفر تفاصيل لهذه المنطقة حالياً.');
    } catch {
      if (request === requestRef.current) setSummaryError('تعذر تحميل تفاصيل المنطقة. اختر المنطقة للمحاولة من جديد.');
    } finally {
      if (request === requestRef.current) setSummaryLoading(false);
    }
  }, []);

  useEffect(() => () => { requestRef.current += 1; }, []);

  useEffect(() => {
    mapStateRef.current = { activeLayers, scenario: activeScenario };
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    LAYER_CONFIGS.forEach((layer) => {
      const id = layer.id + '-layer';
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', activeLayers[layer.id] ? 'visible' : 'none');
    });
    if (map.getLayer(VIABILITY_LAYER)) {
      map.setLayoutProperty(VIABILITY_LAYER, 'visibility', activeLayers.viability ? 'visible' : 'none');
      const data = payload?.layers?.viability?.[activeScenario];
      if (data && map.getSource(VIABILITY_SOURCE)) map.getSource(VIABILITY_SOURCE).setData(data);
    }
  }, [activeLayers, activeScenario, payload]);

  useEffect(() => {
    if (!payload || loading || !mapToken || !mapNodeRef.current) return undefined;
    let map;
    let resizeObserver;
    const view = payload.mapView || {};
    try {
      mapboxgl.accessToken = mapToken;
      map = new mapboxgl.Map({
        container: mapNodeRef.current,
        style: MAP_STYLE,
        center: view.center || [-5.2, 33.0],
        zoom: view.zoom ?? 5,
        maxBounds: view.bounds || [[-12.5, 26.5], [-0.5, 36.5]],
        locale: {
          'NavigationControl.ResetDirection': 'إعادة توجيه الخريطة',
          'NavigationControl.ZoomIn': 'تكبير الخريطة',
          'NavigationControl.ZoomOut': 'تصغير الخريطة',
        },
      });
    } catch {
      setMapError(true);
      return undefined;
    }

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');
    const handleLoad = () => {
      setMapError(false);
      LAYER_CONFIGS.forEach((layer) => {
        const data = payload.layers?.[layer.id];
        if (!data) return;
        map.addSource(layer.id + '-source', { type: 'geojson', data });
        map.addLayer({
          id: layer.id + '-layer',
          type: 'fill',
          source: layer.id + '-source',
          paint: { 'fill-color': layer.color, 'fill-opacity': 0.25 },
          layout: { visibility: mapStateRef.current.activeLayers[layer.id] ? 'visible' : 'none' },
        });
      });
      const regions = payload.layers?.viability?.[mapStateRef.current.scenario];
      if (regions) {
        map.addSource(VIABILITY_SOURCE, { type: 'geojson', data: regions });
        map.addLayer({
          id: VIABILITY_LAYER,
          type: 'fill',
          source: VIABILITY_SOURCE,
          paint: { 'fill-color': '#7b2438', 'fill-opacity': 0.06, 'fill-outline-color': '#7b2438' },
          layout: { visibility: mapStateRef.current.activeLayers.viability ? 'visible' : 'none' },
        });
      }
    };
    const handleMapError = () => setMapError(true);
    const handleClick = (event) => {
      if (!map.getLayer(VIABILITY_LAYER) || !mapStateRef.current.activeLayers.viability) return;
      const features = map.queryRenderedFeatures(event.point, { layers: [VIABILITY_LAYER] });
      if (features[0]?.properties?.regionId) loadSummary(features[0].properties.regionId);
    };
    map.on('load', handleLoad);
    map.on('error', handleMapError);
    map.on('click', handleClick);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(mapNodeRef.current);
    }
    return () => {
      resizeObserver?.disconnect();
      map.off('load', handleLoad);
      map.off('error', handleMapError);
      map.off('click', handleClick);
      map.remove();
      mapRef.current = null;
    };
  }, [payload, loading, mapToken, loadSummary]);

  const toggleLayer = (id) => setActiveLayers((current) => ({ ...current, [id]: !current[id] }));
  const sample = isSample === true;
  const unverified = isSample !== false || dataStatus === 'unverified';
  const status = sample ? 'بيانات توضيحية' : unverified ? 'تحتاج إلى تحقق'
    : dataStatus === 'partial' ? 'بيانات غير مكتملة' : 'بيانات متاحة';
  const caveat = warning || (unverified ? 'مصدر البيانات وفترة الرصد غير متحقق منهما.' : null);
  const window = payload?.timeWindow;
  const regions = Array.isArray(payload?.riskScores) ? payload.riskScores : [];
  const canvasVisible = payload && !loading && Boolean(mapToken);

  return (
    <section className="climate-page" aria-label="المؤشرات المناخية للمناطق">
      <header className="field-heading">
        <div>
          <p className="field-eyebrow">المناخ والمكان</p>
          <h2>قراءة مناخية للمناطق</h2>
          <p className="field-muted">الحرارة والهطول والبرودة ضمن فترة الرصد المتاحة.</p>
        </div>
        <span className={'field-status' + (sample || unverified || dataStatus === 'partial' ? ' field-status--warning' : '')}>
          {loading ? 'جارٍ التحديث' : status}
        </span>
      </header>

      <section className="field-surface" aria-label="مصدر وفترة بيانات المناخ">
        {caveat ? <div className="field-notice field-notice--warning" role="status">{caveat}</div> : null}
        <div className="field-data-meta" style={{ borderTop: caveat ? undefined : 0, paddingTop: caveat ? undefined : 0, marginTop: caveat ? undefined : 0 }}>
          <span>المصدر: <bdi>{contextSource(source)}</bdi></span>
          <span>الفترة: {climatePeriod(window)}</span>
          <span>تحديث البيانات: {contextDate(asOf)}</span>
          <span>التوقيت: المغرب</span>
        </div>
        <p className="field-muted">تراكم البرودة في أيام الرصد ليس مجموع موسم البرودة. ملاءمة الصنف والإنتاج غير محسومين بهذه المؤشرات.</p>
      </section>

      {loading ? <p className="field-muted" role="status">جارٍ تحميل المؤشرات المناخية...</p> : null}
      {error ? <p className="field-muted" role="alert">تعذر تحميل المؤشرات المناخية. يرجى المحاولة لاحقاً.</p> : null}

      {!loading && payload ? (
        <div className="climate-layout">
          <section className="field-surface climate-map" aria-labelledby="climate-map-title">
            <div className="climate-map__heading">
              <div className="climate-controls">
                <h3 id="climate-map-title">خريطة المؤشرات</h3>
                {scenarios.length > 1 ? (
                  <label>
                    طبقة مناطق الدراسة
                    <select value={activeScenario} onChange={(event) => setScenario(event.target.value)} disabled={!canvasVisible}>
                      {scenarios.map((item) => <option key={item} value={item}>{item === 'current' ? 'الفترة الحالية' : 'سيناريو ' + item}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
              <p className="field-muted">اختر منطقة من الخريطة أو القائمة لقراءة تفاصيلها. حدود العرض تقريبية.</p>
              {activeScenario !== 'current' ? (
                <p className="field-muted">السيناريو يغيّر طبقة مناطق الدراسة فقط؛ تبقى طبقات الرصد مرتبطة بالفترة الحالية.</p>
              ) : null}
            </div>
            {canvasVisible ? (
              <>
                <div ref={mapNodeRef} className="climate-map__canvas" role="region" aria-label="خريطة المناطق؛ التفاصيل متاحة أيضاً في قائمة المناطق" />
                {mapError ? <p className="climate-map__message" role="status">تعذر عرض بعض عناصر الخريطة. يمكنك استخدام قائمة المناطق لقراءة المؤشرات.</p> : null}
              </>
            ) : (
              <div className="climate-map__unavailable">
                <strong>الخريطة غير متاحة حالياً</strong>
                <p>يمكنك قراءة المؤشرات وتفاصيل المنطقة من القائمة. ستظهر الخريطة عند توفر خدمة العرض.</p>
              </div>
            )}
            <fieldset className="climate-layers" style={{ borderInline: 0, borderBottom: 0, margin: 0 }}>
              <legend className="sr-only">طبقات الخريطة</legend>
              {LAYER_CONFIGS.map((layer) => {
                const enabled = canvasVisible && Boolean(payload.layers?.[layer.id]);
                return (
                  <label key={layer.id} className={'climate-layer' + (!enabled ? ' climate-layer--disabled' : '')}>
                    <input type="checkbox" checked={enabled && Boolean(activeLayers[layer.id])} onChange={() => toggleLayer(layer.id)} disabled={!enabled} />
                    <span className="climate-layer__dot" style={{ background: layer.color }} aria-hidden="true" />
                    {layer.label}
                  </label>
                );
              })}
              <label className={'climate-layer' + (!canvasVisible || !scenarios.length ? ' climate-layer--disabled' : '')}>
                <input type="checkbox" checked={canvasVisible && scenarios.length > 0 && activeLayers.viability} onChange={() => toggleLayer('viability')} disabled={!canvasVisible || !scenarios.length} />
                <span className="climate-layer__dot" style={{ background: '#7b2438' }} aria-hidden="true" />
                مناطق الدراسة
              </label>
            </fieldset>
          </section>

          <aside className="climate-sidebar">
            <section className="field-surface" aria-labelledby="climate-regions-title">
              <h3 id="climate-regions-title">المناطق والمؤشرات</h3>
              {!regions.length ? <p className="field-muted">لا تتوفر مؤشرات للمناطق بعد.</p> : null}
              <ul className="climate-regions">
                {regions.map((region) => (
                  <li key={region.regionId}>
                    <button type="button" onClick={() => loadSummary(region.regionId)} aria-pressed={selectedRegion === region.regionId} aria-controls="climate-region-detail">
                      <span>
                        <span className="climate-region__name">{region.regionName}</span>
                        {region.hint ? <span className="climate-region__hint">{region.hint}</span> : null}
                      </span>
                      <span className="field-status">{sample ? 'توضيحي' : unverified ? 'غير متحقق' : region.status || 'غير محدد'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section id="climate-region-detail" className="field-surface climate-summary" aria-labelledby="climate-region-title" aria-busy={summaryLoading} data-tts-key={'climate-summary-' + (selectedRegion || 'none')}>
              <h3 id="climate-region-title">تفاصيل المنطقة</h3>
              {summaryLoading ? <p className="field-muted" role="status">جارٍ تحميل تفاصيل المنطقة...</p> : null}
              {summaryError ? <p className="field-muted" role="status">{summaryError}</p> : null}
              {!summary && !summaryLoading && !summaryError ? <p className="field-muted">اختر منطقة لعرض المصدر وفترة الرصد والمؤشرات المتاحة.</p> : null}
              {summary && !summaryLoading ? <RegionSummary summary={summary} /> : null}
            </section>
          </aside>
        </div>
      ) : null}
    </section>
  );
};

const RegionSummary = ({ summary }) => {
  const sample = summary.isSample === true;
  const verifiedPeriod = summary.isSample === false && summary.timeWindow?.period === '7_completed_days';
  const futureWindow = summary.rainfall?.futureWindow;
  const futureYear = futureWindow?.startDate?.slice(0, 4);
  return (
    <>
      <div className="field-heading">
        <h4>{summary.name || 'المنطقة المختارة'}</h4>
        <span className={'field-status' + (!verifiedPeriod ? ' field-status--warning' : '')}>{sample ? 'توضيحي' : verifiedPeriod ? 'رصد محدود المدة' : 'غير متحقق'}</span>
      </div>
      {summary.warning ? <p className="field-muted">{summary.warning}</p> : null}
      <div className="field-data-meta">
        <span>المصدر: <bdi>{contextSource(summary.source)}</bdi></span>
        <span>{climatePeriod(summary.timeWindow)}</span>
        <span>تحديث البيانات: {contextDate(summary.asOf)}</span>
      </div>
      <dl className="climate-summary__metrics">
        <div><dt>الهطول خلال الأيام السبعة المكتملة</dt><dd><bdi>{verifiedPeriod ? contextNumber(summary.rainfall?.current, 'مم') : '—'}</bdi></dd></div>
        <div><dt>تراكم البرودة خلال الفترة نفسها</dt><dd><bdi>{verifiedPeriod ? contextNumber(summary.chillHours?.current, 'ساعة', 0) : '—'}</bdi></dd></div>
        <div><dt>مجموع موسم البرودة</dt><dd>غير متاح</dd></div>
        <div><dt>ملاءمة الأصناف</dt><dd>غير محسومة</dd></div>
      </dl>
      {verifiedPeriod && futureWindow && summary.rainfall?.future !== null && summary.rainfall?.future !== undefined ? (
        <div className="field-notice">
          <strong>سيناريو الهطول {futureYear ? 'لعام ' + futureYear : ''}</strong>
          <p><bdi>{contextNumber(summary.rainfall.future, 'مم')}</bdi></p>
          <p className="field-muted">{climatePeriod(futureWindow)}. هذا السيناريو يغطي الفترة المماثلة من التقويم؛ لا يمثل تقديراً سنوياً أو توقعاً للمحصول.</p>
        </div>
      ) : null}
      <p className="field-muted">{verifiedPeriod
        ? 'هذه قراءة لفترة قصيرة. تقييم الموسم والصنف يحتاج إلى بيانات البرودة الموسمية ومراجعة الخبير.'
        : 'لم تُعرض القيم العددية لأن مصدرها أو فترة رصدها غير متحقق منهما.'}
      </p>
      {verifiedPeriod && Array.isArray(summary.recommendation) && summary.recommendation.length ? (
        <ul className="climate-summary__recommendations">{summary.recommendation.map((line, index) => <li key={index}>{line}</li>)}</ul>
      ) : null}
    </>
  );
};

export default PageClimate;

