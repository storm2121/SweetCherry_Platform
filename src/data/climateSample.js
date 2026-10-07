export const SAMPLE_CLIMATE = {
  generatedAt: 1763308800000,
  mapView: {
    center: [-5.05, 33.95],
    zoom: 7.2,
    bounds: [
      [-5.75, 33.2],
      [-4.2, 34.85],
    ],
  },
  layers: {
    temperature: {
      type: 'FeatureCollection',
      features: [
        featurePolygon([-5.15, 34.05], [-4.45, 33.62], { label: 'Sefrou', tempMax: 24, tempMin: 11 }),
        featurePolygon([-5.45, 33.62], [-4.95, 33.25], { label: 'Azrou', tempMax: 21, tempMin: 8 }),
        featurePolygon([-5.35, 33.75], [-4.85, 33.35], { label: 'Ifrane', tempMax: 20, tempMin: 7 }),
        featurePolygon([-5.65, 33.85], [-5.05, 33.45], { label: 'El Hajeb', tempMax: 23, tempMin: 10 }),
        featurePolygon([-5.05, 34.75], [-4.25, 34.25], { label: 'Taounate', tempMax: 26, tempMin: 12 }),
      ],
    },
    rainfall: {
      type: 'FeatureCollection',
      features: [
        featurePolygon([-5.15, 34.05], [-4.45, 33.62], { label: 'Sefrou', rainfallMm: 38 }),
        featurePolygon([-5.45, 33.62], [-4.95, 33.25], { label: 'Azrou', rainfallMm: 46 }),
        featurePolygon([-5.35, 33.75], [-4.85, 33.35], { label: 'Ifrane', rainfallMm: 50 }),
        featurePolygon([-5.65, 33.85], [-5.05, 33.45], { label: 'El Hajeb', rainfallMm: 36 }),
        featurePolygon([-5.05, 34.75], [-4.25, 34.25], { label: 'Taounate', rainfallMm: 42 }),
      ],
    },
    chillHours: {
      type: 'FeatureCollection',
      features: [
        featurePolygon([-5.15, 34.05], [-4.45, 33.62], { label: 'Sefrou', chillHours: 760 }),
        featurePolygon([-5.45, 33.62], [-4.95, 33.25], { label: 'Azrou', chillHours: 880 }),
        featurePolygon([-5.35, 33.75], [-4.85, 33.35], { label: 'Ifrane', chillHours: 920 }),
        featurePolygon([-5.65, 33.85], [-5.05, 33.45], { label: 'El Hajeb', chillHours: 740 }),
        featurePolygon([-5.05, 34.75], [-4.25, 34.25], { label: 'Taounate', chillHours: 620 }),
      ],
    },
    drought: {
      type: 'FeatureCollection',
      features: [
        featurePolygon([-5.65, 34.75], [-4.25, 33.25], { label: 'SweetCherry project belt', droughtIndex: 0.38 }),
      ],
    },
    viability: {
      current: {
        type: 'FeatureCollection',
        features: [
          featurePolygon([-5.15, 34.05], [-4.45, 33.62], { regionId: 'sefrou', variety: 'Burlat', rating: 'good' }),
          featurePolygon([-5.45, 33.62], [-4.95, 33.25], { regionId: 'azrou', variety: 'Kordia', rating: 'good' }),
          featurePolygon([-5.35, 33.75], [-4.85, 33.35], { regionId: 'ifrane', variety: 'Burlat', rating: 'good' }),
          featurePolygon([-5.65, 33.85], [-5.05, 33.45], { regionId: 'el_hajeb', variety: 'Summit', rating: 'good' }),
          featurePolygon([-5.05, 34.75], [-4.25, 34.25], { regionId: 'taounate', variety: 'Regina', rating: 'watch' }),
        ],
      },
      '2030': {
        type: 'FeatureCollection',
        features: [
          featurePolygon([-5.15, 34.05], [-4.45, 33.62], { regionId: 'sefrou', variety: 'Burlat', rating: 'good' }),
          featurePolygon([-5.45, 33.62], [-4.95, 33.25], { regionId: 'azrou', variety: 'Kordia', rating: 'good' }),
          featurePolygon([-5.35, 33.75], [-4.85, 33.35], { regionId: 'ifrane', variety: 'Burlat', rating: 'good' }),
          featurePolygon([-5.65, 33.85], [-5.05, 33.45], { regionId: 'el_hajeb', variety: 'Summit', rating: 'watch' }),
          featurePolygon([-5.05, 34.75], [-4.25, 34.25], { regionId: 'taounate', variety: 'Regina', rating: 'watch' }),
        ],
      },
      '2050': {
        type: 'FeatureCollection',
        features: [
          featurePolygon([-5.15, 34.05], [-4.45, 33.62], { regionId: 'sefrou', variety: 'Burlat', rating: 'watch' }),
          featurePolygon([-5.45, 33.62], [-4.95, 33.25], { regionId: 'azrou', variety: 'Kordia', rating: 'good' }),
          featurePolygon([-5.35, 33.75], [-4.85, 33.35], { regionId: 'ifrane', variety: 'Burlat', rating: 'good' }),
          featurePolygon([-5.65, 33.85], [-5.05, 33.45], { regionId: 'el_hajeb', variety: 'Summit', rating: 'watch' }),
          featurePolygon([-5.05, 34.75], [-4.25, 34.25], { regionId: 'taounate', variety: 'Regina', rating: 'watch' }),
        ],
      },
    },
  },
  riskScores: [
    { regionId: 'sefrou', regionName: 'Sefrou', score: 0.34, status: 'stable', hint: 'Balanced chill and rainfall for cherry orchards.', trend: 'stable' },
    { regionId: 'azrou', regionName: 'Azrou', score: 0.25, status: 'stable', hint: 'Strong chill accumulation with moderate disease pressure.', trend: 'stable' },
    { regionId: 'ifrane', regionName: 'Ifrane', score: 0.22, status: 'stable', hint: 'High chill potential; monitor frost around flowering.', trend: 'stable' },
    { regionId: 'el_hajeb', regionName: 'El Hajeb', score: 0.38, status: 'watch', hint: 'Good production fit with irrigation monitoring.', trend: 'stable' },
    { regionId: 'taounate', regionName: 'Taounate', score: 0.46, status: 'watch', hint: 'Warmer conditions can raise heat and disease risk.', trend: 'up' },
  ],
  regionSummaries: {
    sefrou: makeRegionSummary('Sefrou', 38, 760),
    azrou: makeRegionSummary('Azrou', 46, 880),
    ifrane: makeRegionSummary('Ifrane', 50, 920),
    el_hajeb: makeRegionSummary('El Hajeb', 36, 740),
    taounate: makeRegionSummary('Taounate', 42, 620),
  },
};

function makeRegionSummary(name, rainfall, chillHours) {
  return {
    name,
    suitabilityTrend: 'Suitable cherry-growing region with monitoring needed for heat, frost, humidity, and rainfall.',
    rainfall: { current: rainfall, future: Math.max(0, rainfall - 5) },
    chillHours: { current: chillHours, future: Math.max(0, chillHours - 60) },
    recommendation: [
      'Monitor rainfall and humidity around flowering and fruit development.',
      'Use expert-reviewed diagnosis records to refine disease-risk guidance over time.',
    ],
  };
}

function featurePolygon(topLeft, bottomRight, properties) {
  const [lon1, lat1] = topLeft;
  const [lon2, lat2] = bottomRight;
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lon1, lat1],
          [lon2, lat1],
          [lon2, lat2],
          [lon1, lat2],
          [lon1, lat1],
        ],
      ],
    },
  };
}
