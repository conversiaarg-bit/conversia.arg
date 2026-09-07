import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

type Format = '9:16' | '4:5' | '1:1';

const FORMAT_SIZE: Record<Format, [number, number]> = {
  '9:16': [576, 1024],
  '4:5': [640, 800],
  '1:1': [1024, 1024],
};

const STYLE_PROMPTS: Record<string, string> = {
  'Hook urgencia':   'luxury product advertisement, dramatic cinematic lighting, dark moody background, ultra realistic, 8k',
  'Oferta limitada': 'vibrant sale advertisement, bold colors, product hero shot, commercial photography, high energy',
  'Unboxing':        'product unboxing photography, lifestyle setting, warm natural lighting, e-commerce style',
  'Comparativa':     'clean product comparison, studio photography, white background, professional product shot',
  'Testimonial':     'lifestyle product photography, happy person using product, bright natural environment, authentic',
  'Producto hero':   'luxury hero product shot, dramatic studio lighting, dark background, ultra detailed, cinematic',
};

const HF_MODEL = 'black-forest-labs/FLUX.1-schnell';
const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

@Injectable()
export class GenerativeService {
  private readonly apiKey: string;
  private readonly enabled: boolean;
  private readonly logger = new Logger(GenerativeService.name);

  constructor(private readonly config: ConfigService) {
    this.apiKey = config.get<string>('huggingface.apiKey') ?? '';
    this.enabled = !!this.apiKey;
    if (!this.enabled) {
      this.logger.warn('HUGGINGFACE_API_KEY not set — AI image generation disabled');
    } else {
      this.logger.log('HuggingFace FLUX.1-schnell ready');
    }
  }

  // ── Build optimized prompt ─────────────────────────────────────────────────

  buildPrompt(product: string, style: string, hook?: string): string {
    const styleDesc = STYLE_PROMPTS[style] ?? 'professional product advertisement, high quality';
    const hookPart = hook ? `, "${hook}" text concept` : '';
    return `${product}${hookPart}, ${styleDesc}, Meta Ads creative, social media advertisement, photorealistic, no text overlay, no watermark, clean composition`;
  }

  // ── Generate image via HuggingFace FLUX.1-schnell (direct fetch) ──────────

  async generateImage(product: string, style: string, format: Format = '9:16', hook?: string): Promise<string> {
    if (!this.enabled) {
      throw new Error('HUGGINGFACE_API_KEY no configurado. Agregalo en Railway → Variables.');
    }

    const prompt = this.buildPrompt(product, style, hook);
    const [width, height] = FORMAT_SIZE[format];

    this.logger.log(`[HF] Calling FLUX.1-schnell: "${prompt.slice(0, 60)}..." ${width}x${height}`);

    const response = await axios.post(HF_API_URL, {
      inputs: prompt,
      parameters: { width, height, num_inference_steps: 4 },
    }, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'x-wait-for-model': 'true',
      },
      responseType: 'arraybuffer',
      timeout: 120_000,
    });

    const contentType = (response.headers['content-type'] as string) ?? 'image/jpeg';
    this.logger.log(`[HF] Response OK — content-type: ${contentType}`);

    const b64 = Buffer.from(response.data as ArrayBuffer).toString('base64');
    const mime = contentType.startsWith('image/') ? contentType.split(';')[0] : 'image/jpeg';
    return `data:${mime};base64,${b64}`;
  }

  // ── Generate image via OpenAI gpt-image-1 (key stays server-side) ─────────
  // The frontend used to call OpenAI directly with VITE_OPENAI_API_KEY, which
  // leaks the key into the browser bundle. This keeps it on the server.
  async generateOpenAIImage(product: string, style: string, format: Format = '9:16', hook?: string, description?: string, promptOverride?: string): Promise<string> {
    const key = this.config.get<string>('openai.apiKey') ?? '';
    if (!key) {
      // Sin OpenAI: caemos a HuggingFace/FLUX (tier gratis) si hay token; si no, error claro.
      if (this.enabled) {
        this.logger.log('[OpenAI] sin key — usando HuggingFace/FLUX');
        return this.generateImage(product, style, format, hook);
      }
      throw new Error('Sin proveedor de imágenes: configurá OPENAI_API_KEY (o HUGGINGFACE_API_KEY gratis) en Railway.');
    }

    const size: Record<Format, string> = { '9:16': '1024x1536', '4:5': '1024x1536', '1:1': '1024x1024' };
    const descPart = description ? `, ${description}` : '';
    const prompt = promptOverride && promptOverride.length > 20
      ? promptOverride
      : `${this.buildPrompt(product, style, hook)}${descPart}`;

    this.logger.log(`[OpenAI] gpt-image-1: "${prompt.slice(0, 60)}..." ${size[format]}`);

    const res = await axios.post('https://api.openai.com/v1/images/generations', {
      model: 'gpt-image-1', prompt, n: 1, size: size[format], quality: 'low',
    }, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 120_000,
    });

    const b64 = res.data?.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI no devolvió imagen');
    return `data:image/png;base64,${b64}`;
  }
}
