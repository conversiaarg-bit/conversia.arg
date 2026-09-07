// Fallback local de costos (la fuente real es el backend: GET /creative/costs).
// No hardcodear estos valores en componentes: importar SIEMPRE desde acá.
// Créditos proporcionales al costo real de IA (ver backend credits.config.ts).
export const aiCreditsConfig = {
  analyze: 0,
  strategy: 0,
  imageVariant: 1,       // imagen económica ($0.018)
  imageVariantsSet: 3,   // 3 variantes económicas
  imageRegen: 1,
  video5: 7,             // video 5s Seedance ($0.31)
  video10: 13,           // video 10s Seedance ($0.62)
  copy: 0,               // gratis
};

export type AiCreditsConfig = typeof aiCreditsConfig;

// Fallback de opciones de calidad de video (la fuente real es GET /creative/costs).
// Créditos = ceil(costoUSD / 0.05). 720p sin audio = el más barato (default recomendado).
export const videoQualitiesFallback = [
  { key: 'economico', label: '720p · sin audio', resolution: '720p',  audio: false, credits5: 3, credits10: 6 },
  { key: 'hd',        label: '1080p · sin audio', resolution: '1080p', audio: false, credits5: 6, credits10: 12 },
  { key: 'hd_audio',  label: '1080p · con voz', resolution: '1080p', audio: true,  credits5: 7, credits10: 13 },
];
