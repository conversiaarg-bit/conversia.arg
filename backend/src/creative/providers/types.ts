// ── Contratos de proveedores de IA (el sistema NO conoce OpenAI/Seedance) ─────
export type Fmt = '9:16' | '4:5' | '1:1';

export interface ImageGenInput {
  prompt: string;
  format: Fmt;
  quality?: 'standard' | 'premium';
  referenceImage?: string;      // base64/dataURL de la foto real del producto (preservación)
  referenceImages?: string[];   // varias fotos del producto (gpt-image-1 las compone)
}
export interface ImageResult { dataUrl: string; model: string }
export interface ImageProvider {
  readonly name: string;
  readonly enabled: boolean;
  generate(input: ImageGenInput): Promise<ImageResult>;
}

export interface VideoGenInput {
  image: string;             // URL pública o base64 de la imagen base
  prompt: string;            // instrucción de animación (idioma interno)
  duration: 5 | 10;
  resolution?: string;       // '1080p' etc
}
export interface VideoResult { url: string; model: string; seconds: number }
export interface VideoProvider {
  readonly name: string;
  readonly enabled: boolean;
  generate(input: VideoGenInput): Promise<VideoResult>;
}

export interface CopyProvider {
  readonly name: string;
  readonly enabled: boolean;
  // devuelve JSON estructurado; el prompt/schema lo arma quien lo llama
  generateJSON<T = any>(system: string, user: string, maxTokens?: number): Promise<T>;
}

// Tokens DI — el sistema inyecta la interfaz, no la implementación
export const IMAGE_PROVIDER = 'IMAGE_PROVIDER';
export const VIDEO_PROVIDER = 'VIDEO_PROVIDER';
export const COPY_PROVIDER = 'COPY_PROVIDER';
