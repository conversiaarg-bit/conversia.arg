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
    // Costo optimizado: 'low' por defecto (~$0.016, previews) y 'medium' en HD/premium
    // (~$0.06, buena calidad). Evitamos 'high' (~$0.25) que dispara el gasto.
    const quality = input.quality === 'premium' ? 'medium' : 'low';
    const headers = { Authorization: `Bearer ${this.key()}` };

    // Con foto(s) de referencia → images/edits (preserva packaging/logo/forma).
    // gpt-image-1 acepta VARIAS imágenes (las compone). Máx 8 para no excedernos.
    const refs = (input.referenceImages?.length ? input.referenceImages : (input.referenceImage ? [input.referenceImage] : [])).slice(0, 8);
    if (refs.length) {
      try {
        const form = new FormData();
        for (let i = 0; i < refs.length; i++) {
          let ref = refs[i];
          if (/^https?:\/\//.test(ref)) {
            const dl = await axios.get(ref, { responseType: 'arraybuffer', timeout: 30_000 });
            ref = `data:image/png;base64,${Buffer.from(dl.data as ArrayBuffer).toString('base64')}`;
          }
          const b64 = ref.replace(/^data:image\/\w+;base64,/, '');
          form.append('image[]', new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }), `product_${i}.png`);
        }
        form.append('model', model);
        form.append('prompt', input.prompt);
        form.append('size', size);
        form.append('quality', quality);
        // Fidelidad de la referencia: 'low' por defecto (barato). Solo 'high' en HD/premium
        // (preserva el producto EXACTO pero cuesta ~3x). Así el costo queda controlado.
        form.append('input_fidelity', input.quality === 'premium' ? 'high' : 'low');
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
