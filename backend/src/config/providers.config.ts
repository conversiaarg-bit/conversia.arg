// ── Selección de proveedores de IA (configurable por env) ────────────────────
// El resto del sistema usa las interfaces, nunca el proveedor concreto.
export const PROVIDERS = {
  image: process.env.IMAGE_PROVIDER ?? 'openai',            // openai
  video: process.env.VIDEO_PROVIDER ?? 'seedance',          // seedance | magnific
  copy:  process.env.COPY_PROVIDER ?? 'openai',             // openai
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
  openaiChatModel:  process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini',
  seedance: {
    apiKey: process.env.SEEDANCE_API_KEY ?? '',
    apiUrl: process.env.SEEDANCE_API_URL ?? 'https://fal.run/fal-ai/bytedance/seedance/v1.5/pro/image-to-video',
    model:  process.env.SEEDANCE_VIDEO_MODEL ?? 'seedance-1.5-pro',
  },
} as const;
