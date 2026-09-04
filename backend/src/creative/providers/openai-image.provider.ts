import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ImageProvider, ImageGenInput, ImageResult, Fmt } from './types';
import { PROVIDERS } from '../../config/providers.config';

// Único punto que conoce la API de imágenes de OpenAI (gpt-image-2).
@Injectable()
export class OpenAIImageProvider implements ImageProvider {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAIImageProvider.name);
  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean { return !!(this.config.get<string>('openai.apiKey') ?? process.env.OPENAI_API_KEY); }
  private key(): string {
    const k = this.config.get<string>('openai.apiKey') ?? process.env.OPENAI_API_KEY ?? '';
    if (!k) throw new Error('OPENAI_API_KEY no configurado.');
    return k;
  }

  // gpt-image-2 acepta WxH (múltiplos de 16, aspecto 1:3–3:1)
  private static SIZE: Record<Fmt, string> = { '9:16': '1024x1536', '4:5': '1024x1280', '1:1': '1024x1024' };

  async generate(input: ImageGenInput): Promise<ImageResult> {
    const model = PROVIDERS.openaiImageModel;
    const size = OpenAIImageProvider.SIZE[input.format];
    // 'low' por defecto (previews baratas ~$0.016) — 'high' solo en premium.
    const quality = input.quality === 'premium' ? 'high' : 'low';
    const headers = { Authorization: `Bearer ${this.key()}` };

    // Con foto de referencia → images/edits (preserva packaging/logo/forma o el avatar)
    if (input.referenceImage) {
      try {
        let ref = input.referenceImage;
        if (/^https?:\/\//.test(ref)) {
          const dl = await axios.get(ref, { responseType: 'arraybuffer', timeout: 30_000 });
          ref = `data:image/png;base64,${Buffer.from(dl.data as ArrayBuffer).toString('base64')}`;
        }
        const b64 = ref.replace(/^data:image\/\w+;base64,/, '');
        const form = new FormData();
        form.append('image', new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }), 'product.png');
        form.append('model', model);
        form.append('prompt', input.prompt);
        form.append('size', size);
        form.append('n', '1');
        const res = await axios.post('https://api.openai.com/v1/images/edits', form, { headers, timeout: 120_000 });
        const out = res.data?.data?.[0]?.b64_json;
        if (out) return { dataUrl: `data:image/png;base64,${out}`, model };
      } catch (e: any) {
        this.logger.warn(`edits falló (${e.message}) — fallback a generación`);
      }
    }

    const res = await axios.post('https://api.openai.com/v1/images/generations', {
      model, prompt: input.prompt, n: 1, size, quality,
    }, { headers: { ...headers, 'Content-Type': 'application/json' }, timeout: 120_000 });
    const out = res.data?.data?.[0]?.b64_json;
    if (!out) throw new Error('OpenAI no devolvió imagen');
    return { dataUrl: `data:image/png;base64,${out}`, model };
  }
}
