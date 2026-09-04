import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';
import { StorageService } from '../uploads/storage.service';
import { OpenaiService, Fmt } from './openai.service';
import { IMAGE_PROVIDER, VIDEO_PROVIDER, ImageProvider, VideoProvider } from './providers/types';
import { CREATOR_PRESETS, SCENE_BY_CATEGORY, creatorByKey } from './creators.config';
import { expandCommands } from './commands.config';
import { ffmpeg } from '../common/ffmpeg';
import axios from 'axios';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// ── Catálogos (concepto → guía para GPT) ─────────────────────────────────────
export const OBJECTIVES: Record<string, string> = {
  vender:       'conversión directa a venta, urgencia, foco en el producto y el precio',
  promocionar:  'promoción de una oferta/descuento, destacar el ahorro',
  lanzamiento:  'presentar un producto nuevo, expectativa y novedad',
  clientes:     'generar consultas y leads, foco en el beneficio y el contacto',
  redes:        'contenido para Instagram/TikTok/Facebook, scroll-stopper, estético',
  whatsapp:     'iniciar conversaciones por WhatsApp, CTA directo a chatear',
};

export const STYLES: Record<string, string> = {
  profesional: 'professional commercial photography, clean, trustworthy',
  premium:     'luxury premium look, dramatic lighting, high-end',
  minimalista: 'minimalist, lots of negative space, single focal point',
  moderno:     'modern trendy design, bold gradients, contemporary',
  oferta:      'aggressive sale energy, bold colors, big-discount vibe',
  ecommerce:   'clean e-commerce product shot, white/neutral background',
  social:      'social media native, vibrant, thumb-stopping',
  elegante:    'elegant sophisticated, refined palette',
  juvenil:     'youthful, playful, energetic colors',
  tecnologico: 'tech aesthetic, particles, dynamic lighting, cinematic',
  gastronomico:'appetizing food photography, warm lighting, fresh',
  automotriz:  'automotive cinematic, reflections, dynamic lighting',
  retail:      'retail product hero, dynamic, eye-catching',
};

const VARIANT_ANGLES = [
  { key: 'oferta',  label: 'Oferta / Conversión', desc: 'Enfocada en venta y urgencia' },
  { key: 'premium', label: 'Premium',              desc: 'Look sofisticado y aspiracional' },
  { key: 'social',  label: 'Social Media',         desc: 'Nativa para redes, scroll-stopper' },
];

export interface ProductInfo {
  name: string; category?: string; description?: string; features?: string[];
  audience?: string; colors?: string[]; context?: string;
  price?: string; oldPrice?: string; discount?: string; cta?: string;
}

@Injectable()
export class CreativeService {
  private readonly logger = new Logger(CreativeService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly db: Pool,
    private readonly openai: OpenaiService,              // "cerebro" de texto/visión
    @Inject(IMAGE_PROVIDER) private readonly imageProvider: ImageProvider,
    @Inject(VIDEO_PROVIDER) private readonly videoProvider: VideoProvider,
    private readonly storage: StorageService,
  ) {}

  // El controller lo usa para decidir el costo/operación ANTES de generar (ej.
  // cobrar como imagen y no como video-UGC si Seedance todavía no está configurado).
  get videoAvailable(): boolean { return this.videoProvider.enabled; }

  // ── PASO 1: Analizar producto (texto y/o foto) ──────────────────────────────
  async analyzeProduct(input: { name?: string; description?: string; imageBase64?: string }): Promise<ProductInfo> {
    const sys = 'Sos un estratega de marketing. Analizás un producto para publicidad en Latinoamérica.';
    const schema = '{ "name": string, "category": string, "description": string, "features": string[], "audience": string, "colors": string[], "context": string }';

    if (input.imageBase64) {
      const info = await this.openai.chatVisionJSON<ProductInfo>(
        sys,
        `Analizá esta foto de producto y completá: nombre probable, categoría, descripción breve, características visuales, público objetivo, colores dominantes y contexto comercial. Formato JSON: ${schema}`,
        input.imageBase64,
      );
      return { ...info, name: info.name || input.name || 'Producto' };
    }

    const info = await this.openai.chatJSON<ProductInfo>(
      sys,
      `Producto: "${input.name ?? ''}". Descripción: "${input.description ?? ''}". Completá la información faltante para una campaña. JSON: ${schema}`,
    );
    return { ...info, name: info.name || input.name || 'Producto' };
  }

  // ── PASO 2+3: Estrategia creativa (elige estilo si es "auto") ───────────────
  async buildStrategy(input: { product: ProductInfo; objective: string; style: string }) {
    const objGuide = OBJECTIVES[input.objective] ?? OBJECTIVES.vender;
    const styleHint = input.style === 'auto'
      ? `Elegí el mejor estilo entre: ${Object.keys(STYLES).join(', ')}.`
      : `Estilo elegido: ${input.style} (${STYLES[input.style] ?? ''}).`;

    return this.openai.chatJSON<{ chosenStyle: string; concept: string; angle: string; toneNotes: string }>(
      'Sos director creativo publicitario. Definís el concepto de una campaña.',
      `Producto: ${JSON.stringify(input.product)}. Objetivo: ${input.objective} (${objGuide}). ${styleHint}
Devolvé JSON: { "chosenStyle": string (una de las claves de estilo), "concept": string (concepto creativo en 1-2 frases), "angle": string (ángulo principal), "toneNotes": string }`,
    );
  }

  // ── PASO 4: 3 variantes de imagen (GPT arma cada prompt visual → gpt-image) ──
  async generateImageVariants(input: {
    product: ProductInfo; objective: string; style: string; format: Fmt;
    quality?: 'standard' | 'premium'; referenceImage?: string; referenceImages?: string[]; brief?: string;
  }, limit = 3): Promise<Array<{ key: string; label: string; description: string; prompt: string; url: string; model: string }>> {
    const styleDesc = STYLES[input.style] ?? STYLES.profesional;
    const objGuide = OBJECTIVES[input.objective] ?? OBJECTIVES.vender;
    // Comandos "/x" → directivas visuales en inglés; texto libre → pedido explícito.
    const { fragments, rest } = expandCommands(input.brief);
    const briefLine = (fragments.length || rest)
      ? `\nDirectivas comerciales del usuario (aplicá TODO en los 3 prompts, en inglés, foto publicitaria hiperrealista pensada para vender): ${[...fragments, rest].filter(Boolean).join('; ')}. Respetá el producto real de las fotos de referencia.`
      : '';

    // 1 sola llamada GPT arma los 3 prompts visuales (barato)
    const prompts = await this.openai.chatJSON<Array<{ key: string; prompt: string }>>(
      'Sos experto en dirección de arte para Meta Ads. Escribís prompts visuales en inglés para un modelo de imágenes.',
      `Producto: ${JSON.stringify(input.product)}. Objetivo: ${objGuide}. Estilo base: ${styleDesc}.${briefLine}
Escribí 3 prompts visuales EN INGLÉS, uno por ángulo (${VARIANT_ANGLES.map(v => v.key).join(', ')}). Cada prompt debe contemplar: composición, iluminación, fondo, posición del producto, colores, jerarquía visual, espacio para texto publicitario, sin watermarks, formato ad vertical.
JSON: [ { "key": "oferta", "prompt": "..." }, { "key": "premium", "prompt": "..." }, { "key": "social", "prompt": "..." } ]`,
      700,
    );

    // Las 3 variantes se generan EN PARALELO (antes secuencial ~60s → ahora ~20s;
    // clave para no pasarse del timeout del proxy de Vercel).
    const out = await Promise.all(VARIANT_ANGLES.slice(0, limit).map(async angle => {
      const p = prompts.find(x => x.key === angle.key)?.prompt
        ?? `${input.product.name}, ${styleDesc}, ${angle.desc}, professional Meta Ads creative, photorealistic, no watermark`;
      const r = await this.imageProvider.generate({ prompt: p, format: input.format, quality: input.quality ?? 'standard', referenceImage: input.referenceImage, referenceImages: input.referenceImages });
      const url = await this.persist(r.dataUrl, 'image');
      return { key: angle.key, label: angle.label, description: angle.desc, prompt: p, url, model: r.model };
    }));
    return out;
  }

  // Regenerar UNA sola imagen (para "no me gusta esta variante")
  async generateSingleImage(input: { product: ProductInfo; objective: string; style: string; format: Fmt; angleKey?: string; quality?: 'standard' | 'premium'; referenceImage?: string; referenceImages?: string[]; brief?: string }) {
    const styleDesc = STYLES[input.style] ?? STYLES.profesional;
    const angle = VARIANT_ANGLES.find(a => a.key === input.angleKey) ?? VARIANT_ANGLES[0];
    const { fragments: sf, rest: sr } = expandCommands(input.brief);
    const briefLine = (sf.length || sr) ? ` Directivas del usuario (en inglés, publicitario): ${[...sf, sr].filter(Boolean).join('; ')}.` : '';
    const prompt = await this.openai.chat(
      'Sos experto en dirección de arte para Meta Ads. Escribís UN prompt visual en inglés.',
      `Producto: ${JSON.stringify(input.product)}. Estilo: ${styleDesc}. Ángulo: ${angle.label} (${angle.desc}).${briefLine} Un prompt visual en inglés, con composición/iluminación/fondo/espacio para texto, sin watermark.`,
      250,
    );
    const r = await this.imageProvider.generate({ prompt: prompt.trim() || `${input.product.name}, ${styleDesc}`, format: input.format, quality: input.quality ?? 'standard', referenceImage: input.referenceImage, referenceImages: input.referenceImages });
    const url = await this.persist(r.dataUrl, 'image');
    return { key: angle.key, label: angle.label, description: angle.desc, prompt: prompt.trim(), url, model: r.model };
  }

  // ── PASO 5: Video (GPT arma la animación según el producto → VideoProvider) ──
  async generateVideo(input: { imageBase64: string; product: ProductInfo; style: string; duration: '5' | '10' }) {
    const animation = await this.openai.chat(
      'Sos director de cine publicitario. Describís el movimiento de cámara/animación para animar una imagen de producto.',
      `Producto: ${input.product.name} (categoría: ${input.product.category ?? 'general'}). Estilo: ${input.style}.
Escribí en INGLÉS una instrucción de animación ESPECÍFICA para este tipo de producto (no genérica). Ej: gastronómico→vapor y movimiento de ingredientes; automotriz→travelling y reflejos; tecnológico→partículas e iluminación cinematográfica; retail→zoom y movimiento del producto. Máximo 2 frases, solo el movimiento.`,
      150,
    );
    const r = await this.videoProvider.generate({
      image: input.imageBase64,
      prompt: animation.trim() || 'smooth cinematic camera movement, subtle zoom',
      duration: Number(input.duration) as 5 | 10,
      resolution: '1080p',
    });
    return { videoUrl: r.url, animationPrompt: animation.trim(), model: r.model, seconds: r.seconds };
  }

  // ── UGC: auto-selección de creator/escena/hook/acción según el producto ─────
  async pickUGC(product: ProductInfo): Promise<{ creatorKey: string; scene: string; hook: string; action: string; cta: string }> {
    const keys = CREATOR_PRESETS.map(c => `${c.key} (${c.description})`).join(', ');
    const picked = await this.openai.chatJSON<{ creatorKey: string; scene: string; hook: string; action: string; cta: string }>(
      'Sos productor de contenido UGC. Elegís el mejor creador virtual y guion para un producto.',
      `Producto: ${JSON.stringify(product)}. Creadores disponibles: ${keys}.
Devolvé JSON: { "creatorKey": "<una key>", "scene": "escenario en inglés acorde al producto", "hook": "frase de apertura en español (0-2s)", "action": "qué hace con el producto (2-8s)", "cta": "llamado a la acción (8-10s)" }`,
      400,
    );
    return { ...picked, creatorKey: creatorByKey(picked.creatorKey).key };
  }

  // ── UGC: genera imagen de persona sintética + producto → video UGC ──────────
  async generateUGC(input: { product: ProductInfo; creatorKey?: string; scene?: string; hook?: string; action?: string; cta?: string; duration?: '5' | '10'; referenceImage?: string; format?: Fmt }) {
    const creator = creatorByKey(input.creatorKey);
    const scene = input.scene || SCENE_BY_CATEGORY[(input.product.category ?? '').toLowerCase()] || creator.scene;
    const duration = input.duration ?? '10';

    // Imagen: persona SINTÉTICA (sin identidad real) usando el producto, estética UGC vertical
    const imgPrompt = [
      `Vertical smartphone-style UGC photo. A completely fictional AI-generated person (${creator.appearance}, age ${creator.ageRange}), NOT a real or identifiable person, NOT a celebrity.`,
      `In a ${scene}. Naturally holding and using the product "${input.product.name}".`,
      `Authentic organic content look: natural lighting, casual composition, slight imperfections, like a real Reel/TikTok. Face looking toward camera. No watermark, no text overlay.`,
    ].join(' ');
    const img = await this.imageProvider.generate({ prompt: imgPrompt, format: input.format ?? '9:16', quality: 'standard', referenceImage: input.referenceImage });
    const imageUrl = await this.persist(img.dataUrl, 'image');

    // Sin proveedor de video configurado (ej. Seedance sin implementar todavia): se
    // devuelve la imagen igual en vez de tirar la llamada (y la imagen ya pagada)
    // a la basura. El controller ya cobro esto como imagen, no como video.
    if (!this.videoProvider.enabled) {
      return {
        imageUrl, videoUrl: null, videoPending: true,
        creator: { key: creator.key, name: creator.name },
        script: { hook: input.hook ?? '', action: input.action ?? '', cta: input.cta ?? '' },
      };
    }

    // Video UGC: movimiento natural de persona interactuando con el producto
    const animation = `Natural UGC video: the person looks at the camera, holds and shows the product, subtle natural body and hand movements, slight handheld camera motion, organic smartphone-recorded feel. Not a TV commercial.`;
    const vid = await this.videoProvider.generate({ image: img.dataUrl, prompt: animation, duration: Number(duration) as 5 | 10, resolution: '1080p' });

    return {
      imageUrl, videoUrl: vid.url, model: vid.model, seconds: vid.seconds,
      creator: { key: creator.key, name: creator.name },
      script: { hook: input.hook ?? '', action: input.action ?? '', cta: input.cta ?? '' },
    };
  }

  // ── CAMPAÑA UGC (agente planifica escenas tipo nodos: Gancho→Mensaje→Build→CTA) ─
  async planUGCCampaign(product: ProductInfo, creatorKey?: string): Promise<{
    creator: string;
    scenes: Array<{ key: string; title: string; seconds: number; role: string; imagePrompt: string; videoPrompt: string; script: string }>;
  }> {
    const preset = creatorByKey(creatorKey);
    const creator = preset.name;
    const plan = await this.openai.chatJSON<any>(
      'Sos director de campañas UGC. Planificás un video UGC vertical de ~30s en 4 escenas para un producto, protagonizado por UNA persona sintética (nunca real).',
      `Producto: ${JSON.stringify(product)}. Creador (persona sintética): ${preset.name} — ${preset.appearance} (${preset.ageRange}), tono ${preset.tone}. Usá SIEMPRE esta misma persona en todas las escenas.
Planificá 4 escenas de ~7-8s: "hook" (gancho, confesión/curiosidad), "message" (muestra el producto y su beneficio), "build" (prueba/uso, momento culminante), "cta" (llamado a la acción).
Para cada escena devolvé: title (corto, español), seconds (7 u 8), role ("Presentador" o "Producto"), imagePrompt (EN INGLÉS: la persona sintética con el producto en un escenario acorde, estética UGC vertical selfie, sin watermark), videoPrompt (EN INGLÉS: el movimiento/acción natural), script (la frase que dice en español).
JSON: { "creator": "${creator}", "scenes": [ {"key":"hook",...}, {"key":"message",...}, {"key":"build",...}, {"key":"cta",...} ] }`,
      1100,
    );
    return { creator: plan.creator ?? creator, scenes: (plan.scenes ?? []).slice(0, 4) };
  }

  // Genera UNA escena de la campaña (imagen persona+producto → video Seedance)
  async generateUGCScene(input: { product: ProductInfo; scene: { key: string; imagePrompt: string; videoPrompt: string; seconds?: number }; referenceImage?: string; format?: Fmt }) {
    const hasRef = !!input.referenceImage;
    const productLine = hasRef
      ? `The person is clearly holding and showing the EXACT product from the reference image — keep the product packaging, brand, logo, colors and shape IDENTICAL to the reference, fully visible and unchanged, well-lit and in focus.`
      : `holding/using the product "${input.product.name}".`;
    const img = await this.imageProvider.generate({
      prompt: `${input.scene.imagePrompt}. Vertical smartphone UGC photo of a fully fictional AI-generated person (not real, not a celebrity). ${productLine} Natural lighting, no watermark, no text overlay.`,
      format: input.format ?? '9:16', quality: 'standard', referenceImage: input.referenceImage,
    });
    const imageUrl = await this.persist(img.dataUrl, 'image');

    // Sin proveedor de video (Seedance sin configurar): devolvemos la imagen igual,
    // marcando el video como pendiente. No perdemos la imagen ya generada/pagada.
    if (!this.videoProvider.enabled) {
      return { imageUrl, videoUrl: null, videoPending: true, sceneKey: input.scene.key };
    }

    const dur = (input.scene.seconds ?? 8) >= 9 ? 10 : 5;
    const vid = await this.videoProvider.generate({ image: img.dataUrl, prompt: input.scene.videoPrompt || 'natural UGC movement, person interacting with the product', duration: dur as 5 | 10, resolution: '1080p' });
    return { imageUrl, videoUrl: vid.url, model: vid.model, seconds: vid.seconds, sceneKey: input.scene.key };
  }

  // ── Voz (TTS real) ───────────────────────────────────────────────────────────
  async generateVoice(text: string, voiceKey?: string): Promise<{ audioUrl: string }> {
    const dataUrl = await this.openai.speech(text || 'Hola, esto es una muestra de voz.', voiceKey);
    const audioUrl = await this.persist(dataUrl, 'image'); // persist genérico (mp3)
    return { audioUrl };
  }

  // ── Video final: ensambla las escenas (9:16 1080x1920) en un solo MP4 ───────
  async assembleFinalVideo(videoUrls: string[], musicUrl?: string): Promise<{ videoUrl: string }> {
    const urls = (videoUrls || []).filter(Boolean);
    if (!urls.length) throw new BadRequestException('No hay escenas para ensamblar');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ugc_'));
    const files: string[] = [];
    try {
      for (let i = 0; i < urls.length; i++) {
        const dl = await axios.get(urls[i], { responseType: 'arraybuffer', timeout: 60_000 });
        const f = path.join(tmp, `s${i}.mp4`);
        fs.writeFileSync(f, Buffer.from(dl.data as ArrayBuffer));
        files.push(f);
      }
      let music: string | undefined;
      if (musicUrl) {
        try { const dl = await axios.get(musicUrl, { responseType: 'arraybuffer', timeout: 30_000 }); music = path.join(tmp, 'music.mp3'); fs.writeFileSync(music, Buffer.from(dl.data as ArrayBuffer)); } catch { /* opcional */ }
      }
      const out = path.join(tmp, 'final.mp4');
      // Normaliza cada clip a 1080x1920/30fps y concatena (re-encode para tolerar códecs distintos)
      await new Promise<void>((resolve, reject) => {
        const cmd = ffmpeg();
        files.forEach(f => cmd.input(f));
        if (music) cmd.input(music);
        const filters: string[] = [];
        files.forEach((_, i) => filters.push(`[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[v${i}]`));
        filters.push(`${files.map((_, i) => `[v${i}]`).join('')}concat=n=${files.length}:v=1:a=0[outv]`);
        const maps = ['-map', '[outv]'];
        if (music) maps.push('-map', `${files.length}:a`, '-shortest');
        cmd.complexFilter(filters)
          .outputOptions([...maps, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'])
          .output(out)
          .on('end', () => resolve())
          .on('error', err => reject(err))
          .run();
      });
      const b64 = fs.readFileSync(out).toString('base64');
      const videoUrl = await this.persist(`data:video/mp4;base64,${b64}`, 'video');
      return { videoUrl };
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  // ── Favoritos ────────────────────────────────────────────────────────────────
  async toggleFavorite(id: string, userId: string) {
    const { rows } = await this.db.query(
      `UPDATE creatives SET is_favorite = NOT COALESCE(is_favorite,false) WHERE id = $1 AND user_id = $2 RETURNING is_favorite`,
      [id, userId]);
    if (!rows.length) throw new BadRequestException('No encontrado');
    return { is_favorite: rows[0].is_favorite };
  }

  // ── PASO 6: Copy publicitario (3 variantes) ─────────────────────────────────
  async generateCopy(input: { product: ProductInfo; objective: string; style: string }) {
    const objGuide = OBJECTIVES[input.objective] ?? OBJECTIVES.vender;
    return this.openai.chatJSON<Array<{ key: string; title: string; body: string; cta: string; description: string; hashtags: string[] }>>(
      'Sos copywriter publicitario experto en Meta Ads para Latinoamérica. Escribís en español rioplatense, directo y persuasivo.',
      `Producto: ${JSON.stringify(input.product)}. Objetivo: ${objGuide}.
Generá 3 variantes de copy: "conversion" (agresivo, venta), "emotional" (deseo/emoción), "professional" (corporativo). Cada una con título corto, texto principal (2-3 frases), CTA, descripción y 5 hashtags.
JSON: [ { "key": "conversion", "title": "", "body": "", "cta": "", "description": "", "hashtags": [] }, ... ]`,
      900,
    );
  }

  // ── Persistencia de archivos (base64 → StorageService → URL) ────────────────
  private async persist(dataUrl: string, type: 'image' | 'video'): Promise<string> {
    try {
      const m = dataUrl.match(/^data:(.+?);base64,(.*)$/);
      if (!m) return dataUrl; // ya es URL
      const buffer = Buffer.from(m[2], 'base64');
      const mime = m[1];
      const ext = mime.includes('png') ? 'png' : mime.includes('mp4') ? 'mp4' : (mime.includes('mpeg') || mime.includes('mp3')) ? 'mp3' : (mime.includes('wav') ? 'wav' : 'jpg');
      const saved = await this.storage.save(buffer, `creative_${Date.now()}.${ext}`, mime);
      return saved.url;
    } catch (e: any) {
      this.logger.warn(`persist falló (${e.message}) — devuelvo data URL`);
      return dataUrl; // fallback: el front igual lo renderiza
    }
  }

  // ── HISTORIAL ("Mis creativos") ─────────────────────────────────────────────
  async saveCreative(userId: string, dto: {
    name: string; format?: string; type?: string; imageUrl?: string; videoUrl?: string;
    studio: any; creditsUsed?: number;
  }) {
    const { rows } = await this.db.query(
      `INSERT INTO creatives (user_id, name, type, format, status, output_url, video_url, studio, credits_used, ai_prompt)
       VALUES ($1,$2,$3,$4,'ready',$5,$6,$7,$8,$9) RETURNING *`,
      [
        userId, dto.name, dto.type ?? (dto.videoUrl ? 'video' : 'image'),
        (dto.format ?? '9:16').replace(':', '_'), dto.imageUrl ?? null, dto.videoUrl ?? null,
        JSON.stringify(dto.studio ?? {}), dto.creditsUsed ?? 0, dto.studio?.strategy?.concept ?? null,
      ],
    );
    return rows[0];
  }

  async listCreatives(userId: string) {
    const { rows } = await this.db.query(
      `SELECT id, name, type, format, status, output_url, video_url, studio, credits_used, COALESCE(is_favorite,false) AS is_favorite, created_at
       FROM creatives WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [userId],
    );
    return rows;
  }

  async getCreative(id: string, userId: string) {
    const { rows } = await this.db.query('SELECT * FROM creatives WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!rows.length) throw new BadRequestException('No encontrado');
    return rows[0];
  }

  async removeCreative(id: string, userId: string) {
    await this.db.query('DELETE FROM creatives WHERE id = $1 AND user_id = $2', [id, userId]);
    return { ok: true };
  }

  async stats(userId: string) {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int AS creatives,
              COUNT(*) FILTER (WHERE output_url IS NOT NULL)::int AS images,
              COUNT(*) FILTER (WHERE video_url IS NOT NULL)::int AS videos,
              COALESCE(SUM(credits_used),0)::int AS credits_used,
              COUNT(*) FILTER (WHERE created_at > date_trunc('month', NOW()))::int AS this_month
       FROM creatives WHERE user_id = $1`,
      [userId],
    );
    return rows[0];
  }
}
