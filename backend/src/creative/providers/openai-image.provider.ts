import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ImageProvider, ImageGenInput, ImageResult, Fmt } from './types';
import { PROVIDERS } from '../../config/providers.config';

// Único punto que conoce la API de imágenes de OpenAI (gpt-image-1).
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

  // gpt-image-1 SOLO acepta 1024x1024, 1024x1536 (vertical) y 1536x1024 (horizontal).
  // 4:5 no existe → usamos el vertical válido (1024x1536); si no, la API tira 400.
  private static SIZE: Record<Fmt, string> = { '9:16': '1024x1536', '4:5': '1024x1536', '1:1': '1024x1024' };

  // Mensaje REAL de error de OpenAI (no el genérico "status code 400").
  private oaiErr(e: any): string {
    const d = e?.response?.data;
    const m = d?.error?.message || (typeof d === 'string' ? d : '') || e?.message || 'error';
    return String(m).slice(0, 280);
  }

  async generate(input: ImageGenInput): Promise<ImageResult> {
    const model = PROVIDERS.openaiImageModel;
    const size = OpenAIImageProvider.SIZE[input.format];
    // Costo optimizado: 'low' por defecto (~$0.016, previews) y 'medium' en HD/premium
    // (~$0.06, buena calidad). Evitamos 'high' (~$0.25) que dispara el gasto.
    const quality = input.quality === 'premium' ? 'medium' : 'low';
    const headers = { Authorization: `Bearer ${this.key()}` };

    // Con foto(s) de referencia → images/edits (preserva packaging/logo/forma).
    // gpt-image-1 acepta VARIAS imágenes (las compone). Máx 16 (límite del modelo) → soporta combos de 10+.
    const MAX_REFS = Number(process.env.MAX_REFERENCE_IMAGES ?? 16);
    const refs = (input.referenceImages?.length ? input.referenceImages : (input.referenceImage ? [input.referenceImage] : [])).slice(0, MAX_REFS);
    let editsErr = '';
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
        // Fidelidad de la referencia: 'high' cuando hay que reproducir el producto EXACTO
        // (preserveExact o HD/premium). Preserva packaging/logo/texto sin redibujarlo (~3x costo).
        form.append('input_fidelity', (input.preserveExact || input.quality === 'premium') ? 'high' : 'low');
        form.append('n', '1');
        const res = await axios.post('https://api.openai.com/v1/images/edits', form, { headers, timeout: 180_000 });
        const out = res.data?.data?.[0]?.b64_json;
        if (out) return { dataUrl: `data:image/png;base64,${out}`, model };
      } catch (e: any) {
        editsErr = this.oaiErr(e);
        this.logger.warn(`edits falló: ${editsErr}`);
      }
      // Con referencias NO caemos a generación por texto: inventaría un producto
      // que no es el del cliente (peor que un error). Propagamos el motivo real.
      throw new Error(`gpt-image-1 edits: ${editsErr || 'no devolvió imagen'}`);
    }

    try {
      const res = await axios.post('https://api.openai.com/v1/images/generations', {
        model, prompt: input.prompt, n: 1, size, quality,
      }, { headers: { ...headers, 'Content-Type': 'application/json' }, timeout: 180_000 });
      const out = res.data?.data?.[0]?.b64_json;
      if (!out) throw new Error('OpenAI no devolvió imagen');
      return { dataUrl: `data:image/png;base64,${out}`, model };
    } catch (e: any) {
      const msg = this.oaiErr(e);
      throw new Error(`gpt-image-1: ${msg}${editsErr && editsErr !== msg ? ` | edits: ${editsErr}` : ''}`);
    }
  }
}
