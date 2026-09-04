// ── Config central de CRÉDITOS (backend = source of truth) ───────────────────
// Todo configurable por env. 1 crédito = valor comercial interno (NO el costo real).
const n = (v: string | undefined, def: number) => (v != null && v !== '' ? Number(v) : def);

export const CREDIT_VALUE_USD = n(process.env.CREDIT_VALUE_USD, 0.15);

// Costo en CRÉDITOS por operación (lo que se le cobra al usuario)
export const CREDIT_COSTS = {
  image_standard: n(process.env.IMAGE_STANDARD_CREDITS, 1),
  image_premium:  n(process.env.IMAGE_PREMIUM_CREDITS, 3),
  video_5:        n(process.env.VIDEO_5_SECONDS_CREDITS, 5),
  video_10:       n(process.env.VIDEO_10_SECONDS_CREDITS, 10),
  ugc_video_10:   n(process.env.UGC_VIDEO_10_CREDITS, 10),
  product_video_10: n(process.env.PRODUCT_VIDEO_10_CREDITS, 10),
  offer_video_10: n(process.env.OFFER_VIDEO_10_CREDITS, 10),
  copy:           n(process.env.COPY_CREDITS, 0),
} as const;

export type CreditOperation = keyof typeof CREDIT_COSTS;

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
