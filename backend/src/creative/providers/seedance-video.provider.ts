import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { VideoProvider, VideoGenInput, VideoResult } from './types';
import { PROVIDERS } from '../../config/providers.config';

// Seedance 1.5 Pro (image-to-video). Endpoint/host CONFIGURABLE (SEEDANCE_API_URL).
// Default: fal.ai. Otros hosts pueden requerir otro esquema de auth/shape.
// PREPARADO — requiere SEEDANCE_API_KEY para funcionar (sin key: enabled=false).
@Injectable()
export class SeedanceVideoProvider implements VideoProvider {
  readonly name = 'seedance';
  private readonly logger = new Logger(SeedanceVideoProvider.name);

  get enabled(): boolean { return !!PROVIDERS.seedance.apiKey; }

  async generate(input: VideoGenInput): Promise<VideoResult> {
    const { apiKey, apiUrl, model } = PROVIDERS.seedance;
    if (!apiKey) throw new Error('SEEDANCE_API_KEY no configurado.');

    const image_url = input.image; // fal acepta URL pública o data URI
    // generate_audio: fal default es TRUE (paga el doble). Respetamos lo que pida el input (default false).
    const body = {
      image_url, prompt: input.prompt, duration: String(input.duration),
      resolution: input.resolution ?? PROVIDERS.seedance.resolution,
      generate_audio: input.audio ?? PROVIDERS.seedance.audio,
    };
    const headers = { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' };

    this.logger.log(`[Seedance] ${model} — i2v ${input.duration}s`);
    const res = await axios.post(apiUrl, body, { headers, timeout: 180_000 });
    const d = res.data ?? {};

    // Respuesta directa (fal.run bloquea hasta terminar)
    const url = d.video?.url ?? d.video_url ?? d.output?.video?.url ?? d.data?.video?.url;
    if (url) return { url, model, seconds: input.duration };

    // Async (cola): polling por status/response
    const reqId = d.request_id ?? d.id;
    if (reqId) {
      const statusUrl = d.status_url ?? `${apiUrl}/requests/${reqId}/status`;
      const resultUrl = d.response_url ?? `${apiUrl}/requests/${reqId}`;
      const started = Date.now();
      while (Date.now() - started < 180_000) {
        await new Promise(r => setTimeout(r, 5_000));
        const st = await axios.get(statusUrl, { headers, timeout: 20_000 });
        const status = (st.data?.status ?? '').toUpperCase();
        if (status === 'COMPLETED' || status === 'OK') {
          const rr = await axios.get(resultUrl, { headers, timeout: 20_000 });
          const u = rr.data?.video?.url ?? rr.data?.video_url ?? rr.data?.output?.video?.url;
          if (u) return { url: u, model, seconds: input.duration };
          throw new Error('Seedance COMPLETED sin URL');
        }
        if (status === 'FAILED' || status === 'ERROR') throw new Error('Seedance FAILED');
      }
      throw new Error('Seedance timeout');
    }
    throw new Error('Seedance: respuesta inesperada del host');
  }
}
