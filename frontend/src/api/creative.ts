import api from './client';

export type Fmt = '9:16' | '4:5' | '1:1';

export interface ProductInfo {
  name: string; category?: string; description?: string; features?: string[];
  audience?: string; colors?: string[]; context?: string;
  price?: string; oldPrice?: string; discount?: string; cta?: string;
}
export interface ImageVariant { key: string; label: string; description: string; prompt: string; url: string; model?: string }
export interface CopyVariant { key: string; title: string; body: string; cta: string; description: string; hashtags: string[] }
export interface Strategy { chosenStyle: string; concept: string; angle: string; toneNotes: string }
export interface UgcScene { key: string; title: string; seconds: number; role: string; imagePrompt: string; videoPrompt: string; script: string }

// el interceptor del backend envuelve en { success, data }, por eso .data.data
const D = <T,>(p: Promise<{ data: { data: T } }>) => p.then(r => r.data.data);
// clave de idempotencia por generación (evita doble cobro ante reintentos)
const idem = () => ({ headers: { 'Idempotency-Key': (crypto as any).randomUUID?.() ?? String(Date.now() + Math.random()) } });

export interface VideoQualityOption { key: string; label: string; resolution: string; audio: boolean; credits5: number; credits10: number }

export const creativeApi = {
  costs: () => D<{ costs: Record<string, number>; videoQualities: VideoQualityOption[]; videoEnabled: boolean; credits: number }>(api.get('/creative/costs')),

  analyze: (body: { name?: string; description?: string; imageBase64?: string }) =>
    D<ProductInfo>(api.post('/creative/analyze', body, { timeout: 60_000 })),

  removeBg: (image: string) =>
    D<{ imageUrl: string }>(api.post('/creative/remove-bg', { image }, { timeout: 90_000 })),

  analyzeUrl: (url: string) =>
    D<{ name?: string; category?: string; description?: string; features?: string[]; colors?: string[]; price?: string; audience?: string; context?: string }>(api.post('/creative/analyze-url', { url }, { timeout: 45_000 })),

  campaignStrategy: (body: { name?: string; description?: string; objective?: string }) =>
    D<any>(api.post('/creative/campaign-strategy', body, { timeout: 60_000 })),

  // Motor de ad-package: hooks + guion + prompts (imagen/video) + copy + 3 variaciones
  adPackage: (body: { product: ProductInfo; referenceImage?: string; referenceImages?: string[]; avatarUsar?: boolean; seconds?: number }) =>
    D<any>(api.post('/creative/ad-package', body, { timeout: 90_000 })),

  strategy: (body: { product: ProductInfo; objective: string; style: string }) =>
    D<Strategy>(api.post('/creative/strategy', body, { timeout: 60_000 })),

  images: (body: { product: ProductInfo; objective: string; style: string; format: Fmt; quality?: 'standard' | 'premium'; referenceImage?: string; referenceImages?: string[]; brief?: string }) =>
    D<{ variants: ImageVariant[]; credits: number; creditsUsed: number }>(api.post('/creative/images', body, { timeout: 180_000, ...idem() })),

  image: (body: { product: ProductInfo; objective: string; style: string; format: Fmt; angleKey?: string; quality?: 'standard' | 'premium'; referenceImage?: string; referenceImages?: string[]; brief?: string }) =>
    D<{ variant: ImageVariant; credits: number; creditsUsed: number }>(api.post('/creative/image', body, { timeout: 120_000, ...idem() })),

  video: (body: { imageBase64: string; product: ProductInfo; style: string; duration: '5' | '10'; videoQuality?: string }) =>
    D<{ videoUrl: string; animationPrompt: string; credits: number; creditsUsed: number }>(api.post('/creative/video', body, { timeout: 300_000, ...idem() })),

  copy: (body: { product: ProductInfo; objective: string; style: string }) =>
    D<{ variants: CopyVariant[]; credits: number; creditsUsed: number }>(api.post('/creative/copy', body, { timeout: 60_000 })),

  // Combina varias fotos de producto en UNA imagen de combo
  combo: (body: { product: ProductInfo; referenceImages: string[]; brief?: string; quality?: 'standard' | 'premium'; format?: Fmt }) =>
    D<{ imageUrl: string; credits: number; creditsUsed: number }>(api.post('/creative/combo', body, { timeout: 120_000, ...idem() })),

  // UGC (persona IA)
  creators: () => D<{ creators: any[] }>(api.get('/creative/creators')),
  ugcAuto: (body: { product: ProductInfo }) =>
    D<{ creatorKey: string; scene: string; hook: string; action: string; cta: string }>(api.post('/creative/ugc-auto', body, { timeout: 60_000 })),
  ugc: (body: { product: ProductInfo; creatorKey?: string; scene?: string; hook?: string; action?: string; cta?: string; duration?: '5' | '10'; referenceImage?: string; format?: Fmt; videoQuality?: string }) =>
    D<{ imageUrl: string; videoUrl: string; creator: { key: string; name: string }; script: any; credits: number; creditsUsed: number }>(api.post('/creative/ugc', body, { timeout: 300_000, ...idem() })),

  // Pipeline único: OpenAI arma prompts → OpenAI imagen → Seedance 1 video
  ugcOneShot: (body: { product: ProductInfo; referenceImages?: string[]; referenceImage?: string; avatarImage?: string; avatarDesc?: string; brief?: string; scriptOverride?: string; quality?: 'standard' | 'premium'; videoQuality?: string; format?: Fmt; duration?: '5' | '10' }) =>
    D<{ imagePrompt: string; videoPrompt: string; script: string; imageUrl: string; videoUrl: string | null; videoPending?: boolean; credits: number; creditsUsed: number }>(api.post('/creative/ugc-oneshot', body, { timeout: 300_000, ...idem() })),

  // Campaña UGC (agente planifica escenas → nodos)
  ugcPlan: (body: { product: ProductInfo; creatorKey?: string }) =>
    D<{ creator: string; scenes: UgcScene[] }>(api.post('/creative/ugc-campaign/plan', body, { timeout: 90_000 })),
  ugcScene: (body: { product: ProductInfo; scene: UgcScene; referenceImage?: string; referenceImages?: string[]; avatarImage?: string; format?: Fmt; brief?: string; quality?: 'standard' | 'premium'; avatarDesc?: string; videoQuality?: string }) =>
    D<{ imageUrl: string; videoUrl: string | null; videoPending?: boolean; sceneKey: string; credits: number; creditsUsed: number }>(api.post('/creative/ugc-campaign/scene', body, { timeout: 300_000, ...idem() })),

  tts: (text: string, voice?: string) => D<{ audioUrl: string }>(api.post('/creative/tts', { text, voice }, { timeout: 60_000 })),
  assembleFinal: (videoUrls: string[], musicUrl?: string) => D<{ videoUrl: string }>(api.post('/creative/ugc-campaign/assemble', { videoUrls, musicUrl }, { timeout: 200_000 })),
  favorite: (id: string) => D<{ is_favorite: boolean }>(api.post(`/creative/${id}/favorite`, {})),
  save: (body: any) => D<any>(api.post('/creative', body)),
  list: () => D<any[]>(api.get('/creative')),
  stats: () => D<{ creatives: number; images: number; videos: number; credits_used: number; this_month: number }>(api.get('/creative/stats')),
  remove: (id: string) => D<any>(api.delete(`/creative/${id}`)),
};
