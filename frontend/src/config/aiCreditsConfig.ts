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
