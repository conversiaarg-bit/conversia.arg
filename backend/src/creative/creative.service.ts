import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';
import { StorageService } from '../uploads/storage.service';
import { OpenaiService, Fmt } from './openai.service';
import { IMAGE_PROVIDER, VIDEO_PROVIDER, ImageProvider, VideoProvider } from './providers/types';
import { CREATOR_PRESETS, SCENE_BY_CATEGORY, creatorByKey } from './creators.config';
import { expandCommands } from './commands.config';
import { VIDEO_QUALITY, videoQuality } from '../config/credits.config';

// Directiva GLOBAL: siempre que hay una imagen de referencia, se usa el artículo ORIGINAL
// sin modificarlo. La publicidad es de ESE producto, no de uno parecido.
export const PRESERVE_PRODUCT =
  'CRITICAL: Reproduce the EXACT product(s) from the reference image(s) — do NOT redraw, restyle, recolor, relabel, resize or alter the packaging, brand, logo, text, graphics, shapes or proportions in ANY way. Each product must look IDENTICAL to its reference photo (same real product). Only adapt the background, scene, lighting and composition around them. We are advertising THIS exact product, not a similar one.';

// Directiva CINEMATOGRÁFICA para el video (Seedance): trata la imagen como footage real,
// producto bloqueado, cámara DSLR, movimiento sutil físicamente correcto, sin artefactos.
export const PREMIUM_VIDEO_DIRECTIVE =
  'Treat the input image as REAL FOOTAGE — the products are LOCKED: do NOT modify packaging, logos, colors, text or shapes, do NOT add, remove or duplicate products, do NOT morph or distort labels across frames. Cinematic commercial look: simulate a DSLR/mirrorless camera, 35–50mm lens, f/1.8–f/2.8 shallow depth of field, smooth subtle handheld micro-movements (professional, not shaky, no aggressive motion), natural golden-hour light with soft realistic reflections on the packaging, no overexposure, no artificial glow. Hyper-realistic and commercial-grade, NOT AI-looking, no plastic skin or CGI. Motion physically correct with real-world inertia; lighting consistent across all frames; product label pixels preserved. NEGATIVE: no fake brands, no duplicated products, no text errors, no warping, no flicker, no morphing, no surreal effects, no exaggerated motion. Priority order: (1) product fidelity, (2) realism, (3) smooth motion, (4) cinematic quality.';
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
  // true si la media persiste entre deploys (Volume de Railway o S3/R2).
  get storageDurable(): boolean { return this.storage.durable; }

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

    // Product Analyzer (1 sola vez): verdad literal del producto para inyectar en los 3 prompts.
    const hasRef = !!(input.referenceImage || input.referenceImages?.length);
    const { truth: productTruth } = await this.extractProductTruth(hasRef ? (input.referenceImage || input.referenceImages?.[0]) : undefined);

    // Las 3 variantes se generan EN PARALELO (antes secuencial ~60s → ahora ~20s;
    // clave para no pasarse del timeout del proxy de Vercel).
    const out = await Promise.all(VARIANT_ANGLES.slice(0, limit).map(async angle => {
      const p = (prompts.find(x => x.key === angle.key)?.prompt
        ?? `${input.product.name}, ${styleDesc}, ${angle.desc}, professional Meta Ads creative, photorealistic, no watermark`)
        + (hasRef ? ` ${PRESERVE_PRODUCT}${productTruth}` : '');
      const r = await this.imageProvider.generate({ prompt: p, format: input.format, quality: input.quality ?? 'standard', referenceImage: input.referenceImage, referenceImages: input.referenceImages, preserveExact: hasRef });
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
    const hasRef = !!(input.referenceImage || input.referenceImages?.length);
    const { truth: productTruth } = await this.extractProductTruth(hasRef ? (input.referenceImage || input.referenceImages?.[0]) : undefined);
    const finalPrompt = (prompt.trim() || `${input.product.name}, ${styleDesc}`) + (hasRef ? ` ${PRESERVE_PRODUCT}${productTruth}` : '');
    const r = await this.imageProvider.generate({ prompt: finalPrompt, format: input.format, quality: input.quality ?? 'standard', referenceImage: input.referenceImage, referenceImages: input.referenceImages, preserveExact: hasRef });
    const url = await this.persist(r.dataUrl, 'image');
    return { key: angle.key, label: angle.label, description: angle.desc, prompt: prompt.trim(), url, model: r.model };
  }

  // ── PASO 5: Video (GPT arma la animación según el producto → VideoProvider) ──
  async generateVideo(input: { imageBase64: string; product: ProductInfo; style: string; duration: '5' | '10'; videoQuality?: string }) {
    const animation = await this.openai.chat(
      'Sos director de cine publicitario. Describís el movimiento de cámara/animación para animar una imagen de producto.',
      `Producto: ${input.product.name} (categoría: ${input.product.category ?? 'general'}). Estilo: ${input.style}.
Escribí en INGLÉS una instrucción de animación ESPECÍFICA para este tipo de producto (no genérica). Ej: gastronómico→vapor y movimiento de ingredientes; automotriz→travelling y reflejos; tecnológico→partículas e iluminación cinematográfica; retail→zoom y movimiento del producto. Máximo 2 frases, solo el movimiento.`,
      150,
    );
    const q = VIDEO_QUALITY[videoQuality(input.videoQuality)];
    const r = await this.videoProvider.generate({
      image: input.imageBase64,
      prompt: `${animation.trim() || 'smooth cinematic camera movement, subtle zoom'} ${PREMIUM_VIDEO_DIRECTIVE}`,
      duration: Number(input.duration),
      resolution: q.resolution, audio: q.audio,
    });
    const videoUrl = await this.persist(r.url, 'video');
    return { videoUrl, animationPrompt: animation.trim(), model: r.model, seconds: r.seconds };
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
  async generateUGC(input: { product: ProductInfo; creatorKey?: string; scene?: string; hook?: string; action?: string; cta?: string; duration?: '5' | '10'; referenceImage?: string; format?: Fmt; videoQuality?: string }) {
    const creator = creatorByKey(input.creatorKey);
    const scene = input.scene || SCENE_BY_CATEGORY[(input.product.category ?? '').toLowerCase()] || creator.scene;
    const duration = input.duration ?? '10';

    // Imagen: persona SINTÉTICA (sin identidad real) usando el producto, estética UGC vertical
    const imgPrompt = [
      `Vertical smartphone-style UGC photo. A completely fictional AI-generated person (${creator.appearance}, age ${creator.ageRange}), NOT a real or identifiable person, NOT a celebrity.`,
      `In a ${scene}. Naturally holding and using the product "${input.product.name}".`,
      `Authentic organic content look: natural lighting, casual composition, slight imperfections, like a real Reel/TikTok. Face looking toward camera. No watermark, no text overlay.`,
      input.referenceImage ? PRESERVE_PRODUCT : '',
    ].join(' ');
    const img = await this.imageProvider.generate({ prompt: imgPrompt, format: input.format ?? '9:16', quality: 'standard', referenceImage: input.referenceImage, preserveExact: !!input.referenceImage });
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
    const q = VIDEO_QUALITY[videoQuality(input.videoQuality)];
    const vid = await this.videoProvider.generate({ image: img.dataUrl, prompt: `${animation} ${PREMIUM_VIDEO_DIRECTIVE}`, duration: Number(duration), resolution: q.resolution, audio: q.audio });

    return {
      imageUrl, videoUrl: await this.persist(vid.url, 'video'), model: vid.model, seconds: vid.seconds,
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

  // PRODUCT ANALYZER: OpenAI (visión) extrae un JSON literal del producto (marcas/colores/etiquetas)
  // que se inyecta como "verdad absoluta" en los prompts → la IA NO inventa ni redibuja el producto.
  private async extractProductTruth(pic?: string): Promise<{ truth: string; data: any }> {
    if (!pic) return { truth: '', data: null };
    try {
      const data = await this.openai.chatVisionJSON(
        'You are a strict product analyzer. Extract a LITERAL, exact description of ALL visible products. No interpretation, no assumptions — only observable facts.',
        'Return JSON: { "products": [ { "brand": "", "product_name": "", "colors": [], "packaging_type": "", "text_labels": [], "notes": "" } ], "quantity": 0, "arrangement": "" }. Describe exactly what you see: brand names, colors, packaging type, label text, quantity and arrangement.',
        pic, 700,
      );
      return { truth: `\n\nPRODUCT CONSISTENCY ENFORCEMENT — use this data as ABSOLUTE TRUTH. The products are PRESERVED, not generated:\n${JSON.stringify(data)}`, data };
    } catch { return { truth: '', data: null }; }
  }

  // Combina VARIAS fotos de producto en UNA sola imagen de combo (todos los artículos juntos).
  async generateComboImage(input: { product: ProductInfo; referenceImages: string[]; brief?: string; quality?: 'standard' | 'premium'; format?: Fmt }) {
    const pics = (input.referenceImages ?? []).filter(Boolean);
    if (pics.length < 1) throw new BadRequestException('Subí al menos una imagen de producto.');
    const { fragments, rest } = expandCommands(input.brief);
    const cmdLine = (fragments.length || rest) ? ` Commercial directives: ${[...fragments, rest].filter(Boolean).join('; ')}.` : '';
    const prompt = [
      `Professional commercial COMBO product photo: arrange TOGETHER all ${pics.length} products from the reference images as an attractive promotional bundle on a clean, appealing commercial background (studio or lifestyle table), well composed and eye-catching like a real ad.`,
      PRESERVE_PRODUCT,
      `All products fully visible, sharp focus, well-lit, correct proportions.${cmdLine}`,
    ].join(' ');
    const img = await this.imageProvider.generate({
      prompt, format: input.format ?? '9:16', quality: input.quality ?? 'standard',
      referenceImage: pics[0], referenceImages: pics.length > 1 ? pics : undefined,
      preserveExact: true, // el combo SIEMPRE usa el producto exacto
    });
    const imageUrl = await this.persist(img.dataUrl, 'image');
    return { imageUrl, model: img.model };
  }

  // Genera UNA escena de la campaña (imagen persona+producto → video Seedance)
  async generateUGCScene(input: { product: ProductInfo; scene: { key: string; imagePrompt: string; videoPrompt: string; seconds?: number }; referenceImage?: string; referenceImages?: string[]; avatarImage?: string; format?: Fmt; brief?: string; quality?: 'standard' | 'premium'; avatarDesc?: string; videoQuality?: string }) {
    // Fotos del producto: varias = combo (todos los productos juntos en la escena)
    const productPics = (input.referenceImages?.length ? input.referenceImages : [input.referenceImage]).filter(Boolean) as string[];
    const isCombo = productPics.length > 1;
    const hasRef = productPics.length > 0;
    const productLine = !hasRef
      ? `holding/using the product "${input.product.name}".`
      : isCombo
        ? `The person is clearly showing TOGETHER all the EXACT products from the ${productPics.length} reference images as a COMBO/bundle — keep each product's packaging, brand, logo, colors, text and shape IDENTICAL to its reference, all products fully visible, unchanged, well-lit and in sharp focus, arranged naturally together.`
        : `The person is clearly holding and showing the EXACT product from the reference image — keep the product packaging, brand, logo, colors, text and shape IDENTICAL to the reference, fully visible, unchanged, well-lit and in sharp focus, correct proportions.`;
    const personLine = input.avatarImage
      ? `Use the SAME person shown in the reference (same face, hair, look) — keep the avatar consistent.`
      : input.avatarDesc?.trim()
        ? `A person matching this description: ${input.avatarDesc.trim()} (fictional, not a real or identifiable person, not a celebrity).`
        : `A fully fictional AI-generated person (not real, not a celebrity).`;
    const { fragments, rest } = expandCommands(input.brief);
    const cmdLine = (fragments.length || rest) ? ` Commercial directives: ${[...fragments, rest].filter(Boolean).join('; ')}.` : '';
    // Referencias: avatar (persona) primero + todas las fotos de producto (combo). gpt-image-1 las compone.
    const refs = [input.avatarImage, ...productPics].filter(Boolean) as string[];
    const img = await this.imageProvider.generate({
      prompt: `${input.scene.imagePrompt}. Vertical smartphone UGC photo. ${personLine} ${productLine}${hasRef ? ' ' + PRESERVE_PRODUCT : ''}${cmdLine} Natural lighting, no watermark, no text overlay.`,
      format: input.format ?? '9:16', quality: input.quality ?? 'standard',
      referenceImage: refs[0], referenceImages: refs.length > 1 ? refs : undefined,
      preserveExact: hasRef, // si hay producto de referencia, usarlo EXACTO (no redibujar)
    });
    const imageUrl = await this.persist(img.dataUrl, 'image');

    // Sin proveedor de video (Seedance sin configurar): devolvemos la imagen igual,
    // marcando el video como pendiente. No perdemos la imagen ya generada/pagada.
    if (!this.videoProvider.enabled) {
      return { imageUrl, videoUrl: null, videoPending: true, sceneKey: input.scene.key };
    }

    const dur = (input.scene.seconds ?? 8) >= 9 ? 10 : 5;
    const q = VIDEO_QUALITY[videoQuality(input.videoQuality)];
    const vid = await this.videoProvider.generate({ image: img.dataUrl, prompt: `${input.scene.videoPrompt || 'natural UGC movement, person interacting with the product'} ${PREMIUM_VIDEO_DIRECTIVE}`, duration: dur, resolution: q.resolution, audio: q.audio });
    return { imageUrl, videoUrl: await this.persist(vid.url, 'video'), model: vid.model, seconds: vid.seconds, sceneKey: input.scene.key };
  }

  // ── PIPELINE ÚNICO (1 solo video) ────────────────────────────────────────────
  // Input (imágenes + descripciones) → OpenAI arma los prompts (imagen + video) →
  // OpenAI genera la imagen del personaje con el producto EXACTO → Seedance genera UN video.
  async generateOneShotUGC(input: {
    product: ProductInfo; referenceImages?: string[]; referenceImage?: string;
    avatarImage?: string; avatarDesc?: string; brief?: string;
    quality?: 'standard' | 'premium'; videoQuality?: string; format?: Fmt; duration?: '5' | '10';
  }) {
    const productPics = (input.referenceImages?.length ? input.referenceImages : [input.referenceImage]).filter(Boolean) as string[];
    const hasRef = productPics.length > 0;
    const secs = input.duration === '10' ? 10 : 5;
    const characterDesc = input.avatarDesc?.trim()
      || 'a realistic young adult (18–30), authentic UGC creator, friendly and relatable';

    // 1) PRODUCT ANALYZER (visión) → JSON literal de los productos (verdad absoluta).
    const { truth: productTruth, data: productData } = await this.extractProductTruth(hasRef ? productPics[0] : undefined);

    // 2) PROMPT MASTER (OpenAI) → prompt de imagen + prompt de video (premium, en inglés)
    const { fragments, rest } = expandCommands(input.brief);
    const cmdLine = [...fragments, rest].filter(Boolean).join('; ');
    const plan = await this.openai.chatJSON<{ imagePrompt: string; videoPrompt: string; script: string }>(
      'You are the PROMPT MASTER of a high-end commercial UGC pipeline. Products are LOCKED visual assets: NEVER redesign, recolor, relabel or reinvent them. Creativity applies ONLY to the human and the environment. Prioritize realism over style, avoid the "AI look".',
      `Character: ${characterDesc}. Product: ${JSON.stringify(input.product)}.${productTruth}${cmdLine ? '\nUser directives: ' + cmdLine + '.' : ''}
Return JSON with three keys:
- "imagePrompt" (EN INGLÉS): photorealistic UGC image — the person holding the EXACT snack combo from the reference toward the camera. Medium shot (waist up), centered, smiling naturally, products sharp, readable and front-facing. DSLR / commercial camera look, natural golden-hour or soft daylight, shallow depth of field, outdoor casual setting (park/backyard/social), warm inviting atmosphere, background slightly blurred. Hands gripping the bags naturally (no distortions), correct proportions, original packaging reflections and textures preserved. No AI look, no watermark, no text corruption.
- "videoPrompt" (EN INGLÉS): premium ultra-realistic commercial video of ~${secs}s that looks shot with a real camera, using the image as REAL FOOTAGE. Structure: HOOK (0–2s) extreme close-up of the products with subtle natural camera movement and light reflections on the packaging, micro depth-of-field shift; HERO (2–5s) smooth zoom-out / slight reframing showing the full combo, perfect sharpness on products; MICRO-MOTION (5–8s) very subtle parallax (foreground vs background), slight professional handheld motion, realistic natural light; END FRAME (8–10s) stable clean composition ready for a CTA overlay. DSLR/mirrorless 35–50mm, f/1.8–2.8 shallow depth of field, golden-hour soft light. CONTINUITY: products identical in ALL frames — no morphing, no label distortion, no flicker, no extra/duplicated items.
- "script": frase corta en español que la persona dice a cámara.`,
      900,
    );

    // 3) GENERACIÓN DE PERSONAJE (OpenAI imagen) con el producto EXACTO
    const refs = [input.avatarImage, ...productPics].filter(Boolean) as string[];
    const img = await this.imageProvider.generate({
      prompt: `${plan.imagePrompt}${hasRef ? ' ' + PRESERVE_PRODUCT : ''}`,
      format: input.format ?? '9:16', quality: input.quality ?? 'standard',
      referenceImage: refs[0], referenceImages: refs.length > 1 ? refs : undefined,
      preserveExact: hasRef,
    });
    const imageUrl = await this.persist(img.dataUrl, 'image');

    // 4) GENERACIÓN DE VIDEO (Seedance) con el prompt de video
    if (!this.videoProvider.enabled) {
      return { productData, imagePrompt: plan.imagePrompt, videoPrompt: plan.videoPrompt, script: plan.script, imageUrl, videoUrl: null, videoPending: true };
    }
    const q = VIDEO_QUALITY[videoQuality(input.videoQuality)];
    const vid = await this.videoProvider.generate({
      image: img.dataUrl,
      prompt: `${plan.videoPrompt || 'natural UGC movement, person showing the product to camera'} ${PREMIUM_VIDEO_DIRECTIVE}`,
      duration: secs, resolution: q.resolution, audio: q.audio,
    });
    return {
      productData, imagePrompt: plan.imagePrompt, videoPrompt: plan.videoPrompt, script: plan.script,
      imageUrl, videoUrl: await this.persist(vid.url, 'video'), model: vid.model, seconds: vid.seconds,
    };
  }

  // ── Voz (TTS real) ───────────────────────────────────────────────────────────
  async generateVoice(text: string, voiceKey?: string): Promise<{ audioUrl: string }> {
    const dataUrl = await this.openai.speech(text || 'Hola, esto es una muestra de voz.', voiceKey);
    const audioUrl = await this.persist(dataUrl, 'image'); // persist genérico (mp3)
    return { audioUrl };
  }

  // ── Estrategia de campaña (OpenAI) — para el paso "IA analiza" de Nueva Campaña ──
  async campaignStrategy(input: { name?: string; description?: string; objective?: string }): Promise<any> {
    const obj = OBJECTIVES[(input.objective || '').toLowerCase()] ?? 'conversión directa a venta por WhatsApp';
    return this.openai.chatJSON<any>(
      'Sos estratega de Meta Ads para LATAM. Escribís en español rioplatense, directo y persuasivo.',
      `Producto: ${input.name || 'Producto'}. Descripción: ${input.description || input.name || ''}. Objetivo: ${obj}.
Devolvé JSON de estrategia de campaña:
{ "hook": "gancho corto de apertura (español)", "headline": "titular del anuncio", "cta": "llamado a la acción", "audience": { "description": "quién es el público", "age_min": 18, "age_max": 45 }, "format": "9_16", "styleNotes": "notas de estilo visual", "whatsappMessage": "primer mensaje sugerido para el cliente" }`,
      700,
    );
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
  private async persist(src: string, type: 'image' | 'video'): Promise<string> {
    try {
      // Sin storage durable (disco efímero que se borra al redeployar): devolvemos tal cual.
      // Data URL → persiste en la respuesta y en la DB; URL externa → se usa directo.
      // Con Volume de Railway o S3/R2: guardamos el archivo y devolvemos su URL (queda en Railway).
      if (!this.storage.durable) return src;
      let buffer: Buffer; let mime: string;
      const m = src.match(/^data:(.+?);base64,(.*)$/);
      if (m) {
        mime = m[1];
        buffer = Buffer.from(m[2], 'base64');
      } else if (/^https?:\/\//i.test(src)) {
        // Re-hostear media externa (ej. video de fal/Seedance) → copia local persistente
        const resp = await axios.get(src, { responseType: 'arraybuffer', timeout: 120_000 });
        buffer = Buffer.from(resp.data as ArrayBuffer);
        mime = (resp.headers['content-type'] as string) || (type === 'video' ? 'video/mp4' : 'image/jpeg');
      } else {
        return src;
      }
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('mp4') ? 'mp4'
        : (mime.includes('mpeg') || mime.includes('mp3')) ? 'mp3' : mime.includes('wav') ? 'wav' : (type === 'video' ? 'mp4' : 'jpg');
      const saved = await this.storage.save(buffer, `creative_${Date.now()}.${ext}`, mime);
      return saved.url;
    } catch (e: any) {
      this.logger.warn(`persist falló (${e.message}) — devuelvo origen`);
      return src; // fallback: el front igual lo renderiza / reproduce
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
