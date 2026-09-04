import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export type Fmt = '9:16' | '4:5' | '1:1';

// Responsable: TODO lo que use OpenAI (cerebro GPT + generación de imágenes).
@Injectable()
export class OpenaiService {
  private readonly logger = new Logger(OpenaiService.name);

  constructor(private readonly config: ConfigService) {}

  private key(): string {
    const k = this.config.get<string>('openai.apiKey') ?? '';
    if (!k) throw new Error('OPENAI_API_KEY no configurado en Railway → Variables.');
    return k;
  }

  get enabled(): boolean {
    return !!(this.config.get<string>('openai.apiKey') ?? '');
  }

  // ── Cerebro GPT: chat de texto ──────────────────────────────────────────────
  async chat(system: string, user: string, maxTokens = 900): Promise<string> {
    const model = this.config.get<string>('openai.chatModel') ?? 'gpt-4o-mini';
    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.8,
    }, {
      headers: { Authorization: `Bearer ${this.key()}`, 'Content-Type': 'application/json' },
      timeout: 60_000,
    });
    return res.data?.choices?.[0]?.message?.content ?? '';
  }

  // Chat que fuerza salida JSON y la parsea (con fallback defensivo).
  async chatJSON<T = any>(system: string, user: string, maxTokens = 900): Promise<T> {
    const raw = await this.chat(
      `${system}\n\nRespondé SOLO con JSON válido, sin texto adicional ni markdown.`,
      user,
      maxTokens,
    );
    const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // rescatar el primer bloque {...} o [...]
      const m = cleaned.match(/[[{][\s\S]*[\]}]/);
      if (m) return JSON.parse(m[0]) as T;
      throw new Error('GPT no devolvió JSON válido');
    }
  }

  // Chat con imagen (vision) — para analizar la foto del producto.
  async chatVisionJSON<T = any>(system: string, prompt: string, imageBase64: string, maxTokens = 700): Promise<T> {
    const model = this.config.get<string>('openai.chatModel') ?? 'gpt-4o-mini';
    const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;
    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model,
      messages: [
        { role: 'system', content: `${system}\n\nRespondé SOLO con JSON válido.` },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ] },
      ],
      max_tokens: maxTokens,
      temperature: 0.5,
    }, {
      headers: { Authorization: `Bearer ${this.key()}`, 'Content-Type': 'application/json' },
      timeout: 60_000,
    });
    const raw = (res.data?.choices?.[0]?.message?.content ?? '').trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
    try { return JSON.parse(raw) as T; } catch {
      const m = raw.match(/[[{][\s\S]*[\]}]/);
      if (m) return JSON.parse(m[0]) as T;
      throw new Error('GPT vision no devolvió JSON válido');
    }
  }

  // ── Texto a voz (TTS real) ──────────────────────────────────────────────────
  // Presets de la app → voces de OpenAI
  private static VOICE_MAP: Record<string, string> = {
    fem_natural: 'nova', fem_energetica: 'shimmer', masc_natural: 'onyx', masc_pro: 'echo', joven: 'alloy',
  };
  async speech(text: string, voiceKey = 'fem_natural'): Promise<string> {
    const model = process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts';
    const voice = OpenaiService.VOICE_MAP[voiceKey] ?? 'nova';
    const res = await axios.post('https://api.openai.com/v1/audio/speech', {
      model, voice, input: text.slice(0, 4000), response_format: 'mp3',
    }, {
      headers: { Authorization: `Bearer ${this.key()}`, 'Content-Type': 'application/json' },
      responseType: 'arraybuffer', timeout: 60_000,
    });
    const b64 = Buffer.from(res.data as ArrayBuffer).toString('base64');
    return `data:audio/mpeg;base64,${b64}`;
  }

  // ── Generación de imagen (gpt-image-1) ──────────────────────────────────────
  private static readonly SIZE: Record<Fmt, string> = { '9:16': '1024x1536', '4:5': '1024x1536', '1:1': '1024x1024' };

  async generateImage(prompt: string, format: Fmt = '9:16'): Promise<string> {
    this.logger.log(`[OpenAI] gpt-image-1 ${OpenaiService.SIZE[format]}: "${prompt.slice(0, 50)}..."`);
    const res = await axios.post('https://api.openai.com/v1/images/generations', {
      model: 'gpt-image-1', prompt, n: 1, size: OpenaiService.SIZE[format], quality: 'low',
    }, {
      headers: { Authorization: `Bearer ${this.key()}`, 'Content-Type': 'application/json' },
      timeout: 120_000,
    });
    const b64 = res.data?.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI no devolvió imagen');
    return `data:image/png;base64,${b64}`;
  }
}
