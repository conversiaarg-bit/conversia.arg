// ── Config central de CRÉDITOS (backend = source of truth) ───────────────────
// Todo configurable por env. 1 crédito = valor comercial interno (NO el costo real).
const n = (v: string | undefined, def: number) => (v != null && v !== '' ? Number(v) : def);

// Precio de venta de 1 crédito (packs: ~$0.12–0.18; planes: ~$0.13–0.19). Media ≈ $0.15.
export const CREDIT_VALUE_USD = n(process.env.CREDIT_VALUE_USD, 0.15);

// Costo en CRÉDITOS por operación — PROPORCIONAL al costo real de IA.
// Base: 1 crédito ≈ $0.05 de costo real (créditos = ceil(costoReal / 0.05)).
// Vendido a $0.15/crédito → margen ~consistente (~3x) en TODAS las operaciones.
export const CREDIT_COSTS = {
  image_standard: n(process.env.IMAGE_STANDARD_CREDITS, 1),   // $0.018 → 1
  image_premium:  n(process.env.IMAGE_PREMIUM_CREDITS, 2),    // $0.063 → 2
  video_5:        n(process.env.VIDEO_5_SECONDS_CREDITS, 7),  // $0.31 → 7
  video_10:       n(process.env.VIDEO_10_SECONDS_CREDITS, 13),// $0.62 → 13
  ugc_video_10:   n(process.env.UGC_VIDEO_10_CREDITS, 13),    // escena UGC (video)
  product_video_10: n(process.env.PRODUCT_VIDEO_10_CREDITS, 13),
  offer_video_10: n(process.env.OFFER_VIDEO_10_CREDITS, 13),
  copy:           n(process.env.COPY_CREDITS, 0),             // $0.0008 → gratis
} as const;

export type CreditOperation = keyof typeof CREDIT_COSTS;

// Costo real de referencia por crédito (créditos = ceil(costoUSD / esto)).
const REAL_COST_PER_CREDIT = n(process.env.REAL_COST_PER_CREDIT, 0.05);

// ── Calidad de video (elegible al generar) ───────────────────────────────────
// Seedance 1.5 Pro cobra por "tokens de video": (alto×ancho×fps×seg)/1024.
// $1.2/millón sin audio, $2.4/millón con audio (fps=24). usdPerSec ya calculado.
export const VIDEO_QUALITY = {
  economico: { resolution: '720p',  audio: false, usdPerSec: 0.026, label: '720p · sin audio' },
  hd:        { resolution: '1080p', audio: false, usdPerSec: 0.059, label: '1080p · sin audio' },
  hd_audio:  { resolution: '1080p', audio: true,  usdPerSec: 0.117, label: '1080p · con audio' },
} as const;
export type VideoQuality = keyof typeof VIDEO_QUALITY;
export const DEFAULT_VIDEO_QUALITY: VideoQuality = (process.env.VIDEO_QUALITY_DEFAULT as VideoQuality) || 'economico';

export function videoQuality(q?: string): VideoQuality {
  return q && q in VIDEO_QUALITY ? (q as VideoQuality) : DEFAULT_VIDEO_QUALITY;
}
// Créditos que cuesta un video segun calidad + duración (proporcional al costo real).
export function videoCredits(q: string | undefined, seconds: number): number {
  const p = VIDEO_QUALITY[videoQuality(q)];
  return Math.max(1, Math.ceil((p.usdPerSec * seconds) / REAL_COST_PER_CREDIT));
}
export function videoProviderCost(q: string | undefined, seconds: number): number {
  return +(VIDEO_QUALITY[videoQuality(q)].usdPerSec * seconds).toFixed(4);
}

// Precio de proveedor en USD (lista oficial). Ajustable por env a la factura real de cada proveedor.
// Al generar con las keys, el costo REAL registrado = estos precios × uso real (segundos/cantidad).
export const PROVIDER_COSTS_USD = {
  image_standard: n(process.env.IMAGE_COST_USD, 0.018),        // gpt-image-1 'low' 9:16 (medido: ~408 tokens out)
  image_premium:  n(process.env.IMAGE_PREMIUM_COST_USD, 0.063), // gpt-image-1 'medium' 9:16
  video_per_second: n(process.env.VIDEO_COST_PER_SECOND_USD, 0.062), // Seedance 1.5 Pro (fal.ai) 1080p
  copy: n(process.env.COPY_COST_USD, 0.0008),                 // OpenAI gpt-4o-mini (por copy)
  tts:  n(process.env.TTS_COST_USD, 0.012),                   // OpenAI gpt-4o-mini-tts (~30s de voz)
} as const;

export function estimateProviderCost(op: CreditOperation | 'tts', seconds?: number): number {
  if (op === 'copy') return PROVIDER_COSTS_USD.copy;
  if (op === 'tts') return PROVIDER_COSTS_USD.tts;
  if (op === 'image_premium') return PROVIDER_COSTS_USD.image_premium;
  if (op === 'image_standard') return PROVIDER_COSTS_USD.image_standard;
  if (op.includes('video')) {
    const s = seconds ?? (op.includes('_5') ? 5 : 10);
    return +(PROVIDER_COSTS_USD.video_per_second * s).toFixed(4);
  }
  return 0;
}
