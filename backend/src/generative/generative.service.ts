import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ffmpeg } from '../common/ffmpeg';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

type Format = '9:16' | '4:5' | '1:1';
type Movement = 'zoom_in' | 'zoom_out' | 'pan_right' | 'pan_left';

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

  // ── Video dispatcher: Magnific (Kling) if key present, else ffmpeg ─────────
  // Returns something usable as <video src>: a hosted URL (Magnific) or a
  // data: URL (ffmpeg fallback). The frontend handles both transparently.

  async generateVideo(imageBase64: string, format: Format = '9:16', movement: Movement = 'zoom_in'): Promise<string> {
    const magnificKey = this.config.get<string>('magnific.apiKey') ?? '';
    if (magnificKey) {
      try {
        return await this.generateMagnificVideo(imageBase64, movement, magnificKey);
      } catch (err: any) {
        this.logger.warn(`Magnific falló (${err.message}) — fallback a ffmpeg`);
      }
    }
    return this.generateFfmpegVideo(imageBase64, format, movement);
  }

  // ── Real AI video via Magnific (Kling image-to-video) ─────────────────────

  private readonly MOVEMENT_PROMPT: Record<Movement, string> = {
    zoom_in:   'slow cinematic zoom in toward the product, smooth camera push-in, professional commercial',
    zoom_out:  'slow cinematic zoom out revealing the product, smooth camera pull-back, professional commercial',
    pan_right: 'smooth cinematic camera pan to the right across the product, dynamic advertisement shot',
    pan_left:  'smooth cinematic camera pan to the left across the product, dynamic advertisement shot',
  };

  async generateMagnificVideo(imageBase64: string, movement: Movement, key: string): Promise<string> {
    const model    = this.config.get<string>('magnific.videoModel') ?? 'kling-v2';
    const duration = this.config.get<string>('magnific.videoDuration') ?? '5';
    const base     = `https://api.magnific.com/v1/ai/image-to-video/${model}`;
    const image    = imageBase64.replace(/^data:image\/\w+;base64,/, ''); // Magnific accepts raw base64
    const headers  = { 'x-magnific-api-key': key, 'Content-Type': 'application/json' };

    this.logger.log(`[Magnific] ${model} — creando tarea (${duration}s, ${movement})`);
    const create = await axios.post(base, {
      image, duration, prompt: this.MOVEMENT_PROMPT[movement], cfg_scale: 0.5,
    }, { headers, timeout: 30_000 });

    const taskId = create.data?.data?.task_id;
    if (!taskId) throw new Error('Magnific no devolvió task_id');

    // Poll hasta COMPLETED (Kling 5s ≈ 30-90s). ponytail: polling server-side; webhook si escala.
    const started = Date.now();
    while (Date.now() - started < 150_000) {
      await new Promise(r => setTimeout(r, 5_000));
      const st = await axios.get(`${base}/${taskId}`, { headers, timeout: 20_000 });
      const status = st.data?.data?.status;
      if (status === 'COMPLETED') {
        const d = st.data?.data;
        const url = d?.generated?.[0] ?? d?.video?.url ?? d?.result?.[0] ?? d?.url;
        if (!url) throw new Error('Magnific COMPLETED pero sin URL de video');
        this.logger.log(`[Magnific] listo: ${String(url).slice(0, 60)}`);
        return url;
      }
      if (status === 'FAILED') throw new Error('Magnific devolvió FAILED');
    }
    throw new Error('Magnific timeout (>150s)');
  }

  // ── Fallback: cinematic pan/zoom from image using ffmpeg (no AI) ───────────

  async generateFfmpegVideo(imageBase64: string, format: Format = '9:16', movement: Movement = 'zoom_in'): Promise<string> {
    const [width, height] = FORMAT_SIZE[format];
    const tmpDir = os.tmpdir();
    const ts = Date.now();
    const imgPath = path.join(tmpDir, `conversia_img_${ts}.jpg`);
    const vidPath = path.join(tmpDir, `conversia_vid_${ts}.mp4`);

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(imgPath, Buffer.from(base64Data, 'base64'));

    const frames = 150; // 6s at 25fps
    const s = `${width}x${height}`;

    const filterMap: Record<Movement, string> = {
      zoom_in:   `zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s}:fps=25,format=yuv420p`,
      zoom_out:  `zoompan=z='if(lte(on,1),1.4,max(1,zoom-0.002))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s}:fps=25,format=yuv420p`,
      pan_right: `zoompan=z='1.2':x='min(on*3,iw*(1-1/zoom))':y='(ih-oh)/2':d=${frames}:s=${s}:fps=25,format=yuv420p`,
      pan_left:  `zoompan=z='1.2':x='max(iw*(1-1/zoom)-on*3,0)':y='(ih-oh)/2':d=${frames}:s=${s}:fps=25,format=yuv420p`,
    };

    await new Promise<void>((resolve, reject) => {
      ffmpeg(imgPath)
        .inputOptions(['-loop 1', '-framerate 25'])
        .videoFilter(filterMap[movement])
        .outputOptions(['-t 6', '-c:v libx264', '-crf 23', '-preset fast', '-movflags +faststart'])
        .output(vidPath)
        .on('start', cmd => this.logger.log(`ffmpeg: ${cmd.slice(0, 80)}...`))
        .on('end', () => resolve())
        .on('error', err => reject(err))
        .run();
    });

    const videoBuffer = fs.readFileSync(vidPath);
    const b64 = videoBuffer.toString('base64');

    [imgPath, vidPath].forEach(f => { try { fs.unlinkSync(f); } catch { /* ignore */ } });

    return `data:video/mp4;base64,${b64}`;
  }
}
