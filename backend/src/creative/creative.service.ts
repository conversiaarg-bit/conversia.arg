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

// Calidad para imágenes publicitarias (Studio): pro, nítida, sin distorsión ni texto basura.
export const IMAGE_QUALITY_DIRECTIVE =
  'Professional advertising creative, ultra sharp and high detail, photorealistic, correct real-world proportions, clean modern composition with clear focal point and balanced negative space, crisp studio-grade lighting, accurate colors, premium polished finish suitable for Meta Ads. ALL on-image text MUST be written in SPANISH (Argentina / rioplatense), short, correctly spelled and legible — NEVER in English, no gibberish, no distorted letters. NEGATIVE: english text, blurry, low-res, warped or distorted objects, deformed shapes, extra/melted parts, messy composition, ugly artifacts, watermark, gibberish text.';

// Directiva para VIDEO estilo UGC selfie (iPhone, crudo) — NO cinematográfico.
export const UGC_VIDEO_DIRECTIVE =
  'Authentic raw iPhone selfie footage — handheld, daytime white balance, sharp readable background (NO bokeh, NO cinematic depth of field, NO studio look). The product is LOCKED: keep packaging, logos, colors and text identical in every frame, no morphing, no label distortion, no flicker, no extra/duplicated products. Realistic skin and grain, natural gestures, real-world motion; NOT AI-looking, no plastic skin, no beauty filter, no commercial/DSLR look.';
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
      'Sos director de arte de ADS de e-commerce (MercadoLibre / Meta Ads, Argentina). Escribís prompts visuales en INGLÉS para un modelo de imágenes, PERO todo texto que aparezca DENTRO de la imagen va en ESPAÑOL rioplatense. El producto es un asset EXACTO: no lo rediseñes.',
      `Producto: ${JSON.stringify(input.product)}. Objetivo: ${objGuide}. Estilo base: ${styleDesc}.${briefLine}
Escribí 3 prompts visuales EN INGLÉS (uno por ángulo: ${VARIANT_ANGLES.map(v => v.key).join(', ')}). Cada prompt debe describir un AD de e-commerce de alta conversión con:
- El PRODUCTO EXACTO de la referencia (misma estructura, materiales, colores, proporciones — no redibujar).
- Escena realista con fondo contextual acorde al producto, iluminación comercial, sombras suaves, foto de producto hiperrealista (no arte, no abstracto).
- OVERLAYS DE TEXTO EN ESPAÑOL, corto y bien escrito, indicando el texto EXACTO entre comillas: un TITULAR de venta, el PRECIO si el producto lo tiene (usá "$${input.product.price ?? ''}" ${input.product.oldPrice ? 'y precio anterior' : ''}), 2-3 BENEFICIOS clave, y un CTA.
- Íconos minimalistas de los beneficios principales.
- Jerarquía visual clara, espacio limpio para el texto, formato ad vertical, sin watermark, SIN texto en inglés, sin deformar el producto.
JSON: [ { "key": "oferta", "prompt": "..." }, { "key": "premium", "prompt": "..." }, { "key": "social", "prompt": "..." } ]`,
      800,
    );

    // Product Analyzer (1 sola vez): verdad literal del producto para inyectar en los 3 prompts.
    const hasRef = !!(input.referenceImage || input.referenceImages?.length);
    const { truth: productTruth } = await this.extractProductTruth(hasRef ? (input.referenceImage || input.referenceImages?.[0]) : undefined);

    // Las 3 variantes se generan EN PARALELO (antes secuencial ~60s → ahora ~20s;
    // clave para no pasarse del timeout del proxy de Vercel).
    const out = await Promise.all(VARIANT_ANGLES.slice(0, limit).map(async angle => {
      const p = (prompts.find(x => x.key === angle.key)?.prompt
        ?? `${input.product.name}, ${styleDesc}, ${angle.desc}, professional Meta Ads creative, photorealistic, no watermark`)
        + ` ${IMAGE_QUALITY_DIRECTIVE}`
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
    const finalPrompt = (prompt.trim() || `${input.product.name}, ${styleDesc}`) + ` ${IMAGE_QUALITY_DIRECTIVE}` + (hasRef ? ` ${PRESERVE_PRODUCT}${productTruth}` : '');
    const r = await this.imageProvider.generate({ prompt: finalPrompt, format: input.format, quality: input.quality ?? 'standard', referenceImage: input.referenceImage, referenceImages: input.referenceImages, preserveExact: hasRef });
    const url = await this.persist(r.dataUrl, 'image');
    return { key: angle.key, label: angle.label, description: angle.desc, prompt: prompt.trim(), url, model: r.model };
  }

  // ── PASO 5: Video — OpenAI arma un prompt COMPLETO y estructurado para Seedance ──
  async generateVideo(input: { imageBase64: string; product: ProductInfo; style: string; duration: '5' | '10'; videoQuality?: string }) {
    const secs = Number(input.duration);
    const styleDesc = STYLES[input.style] ?? STYLES.profesional;
    // Analyzer: producto exacto como verdad absoluta.
    const { truth } = await this.extractProductTruth(input.imageBase64);
    const plan = await this.openai.chatJSON<{ videoPrompt: string; script: string }>(
      'You are a senior creative director + AI video engineer. You write ONE complete, structured image-to-video prompt for Seedance to produce a Meta Ads UGC-style product ad. The product in the base image is LOCKED: exact design, colors, structure, logos and text — never change or deform it. Realistic, NOT a cinematic movie. Output ONLY valid JSON.',
      `Product: ${JSON.stringify(input.product)}. Style: ${styleDesc}.${truth}
Return JSON with "videoPrompt" and "script".
"videoPrompt" (ENGLISH): a COMPLETE prompt with these LABELED sections, tailored to THIS product:
Reference: use the base image as the EXACT product reference — do not change the product design, colors or structure.
Scene: a realistic everyday setting that fits the product (${secs}s).
Action: a person naturally using/showing the product (realistic hand interaction) OR, if no person fits, subtle real-world product motion.
Camera: start on a medium shot with a slow push-in toward the product, then a slight handheld movement for realism, end on a close-up of the product details.
Lighting: natural, realistic, warm, soft shadows.
Style: UGC-style Meta Ads, realistic, high-quality, NOT cinematic movie style, no text overlays.
End frame: product clearly visible, clean framing for a CTA.
Constraints: no product deformation, no fake objects, no text overlays, realistic hand interaction, product identical in every frame.
"script" (ESPAÑOL rioplatense): la locución hablada que se escucha, clara, natural y vendedora, con un CTA al final, para ~${secs} segundos.`,
      700,
    );
    const q = VIDEO_QUALITY[videoQuality(input.videoQuality)];
    const r = await this.videoProvider.generate({
      image: input.imageBase64,
      prompt: `${plan.videoPrompt || 'smooth product ad, slow push-in, subtle handheld realism'} ${UGC_VIDEO_DIRECTIVE}`,
      duration: secs, resolution: q.resolution, audio: false,
    });
    const videoUrl = q.audio ? await this.muxVoiceover(r.url, plan.script) : await this.persist(r.url, 'video');
    return { videoUrl, animationPrompt: plan.videoPrompt, script: plan.script, model: r.model, seconds: r.seconds };
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
    avatarImage?: string; avatarDesc?: string; brief?: string; scriptOverride?: string;
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
      'You are a prompt engineer for META ADS (Instagram/Facebook Reels & Stories) in iPhone-SELFIE UGC style (Creatify style). Goal: a scroll-stopping vertical 9:16 ad — a strong hook in the first second, the person talking to camera, and a clear CTA. The look is RAW, handheld, authentic phone footage — NOT commercial, NOT DSLR, NOT cinematic, NO bokeh. The product is a LOCKED asset: keep its packaging, colors, logos, materials and text EXACT, no redesign or relabeling; if it is a COMBO show ALL its products. You invent only the person, their outfit and their everyday room. Output ONLY valid JSON.',
      `Product: ${JSON.stringify(input.product)}. Character base: ${characterDesc}.${productTruth}${cmdLine ? '\nUser directives: ' + cmdLine + '.' : ''}
Fill this TEMPLATE for THIS product and return JSON with keys "imagePrompt", "videoPrompt", "script":

"imagePrompt" (ENGLISH, single flowing line using → arrows, MUST follow this exact structure):
handheld iPhone front-camera selfie, 9:16, arm fully extended so the framing is a WIDE MEDIUM selfie showing the person from the head down to the waist/hips with room around them (NOT a tight face close-up), slightly off-center framing with a tiny natural shake, real casual young energy → the product must be kept EXACT: same packaging shapes, colors, logos, materials and text, no redesign or relabeling → one <specific person matching the character base, age, vibe>, bright friendly expression, mid-sentence mouth slightly open, direct eye contact with the lens → a unique specific outfit <describe it> → everyday room behind them clearly visible and readable (posters, backpack, shelves, normal clutter) AND the FULL set of products from the combo reference arranged on a desk/shelf beside or behind them, every product bag visible and readable, no blur, no bokeh → the person is actively taking the selfie while holding ONE product bag from the combo in ONE hand at chest height with a casual tilted grip (bag fully in frame), the other hand holding the phone, weight on one hip, torso slightly rotated, small natural talk-gesture from the wrist → soft natural daylight from a window, daytime white balance, raw iPhone texture, realistic skin and grain, no studio look, no heavy contrast, no cinematic depth of field, authentic handheld snapshot feel; NEGATIVE: extreme close-up, tight face crop, cropped head, product out of frame, stiff pose, mannequin, empty hands, two-hand product presentation, catalog grip, posed smile, studio lighting, strong sun, yellow glow, bokeh, blurry background, plastic skin, beauty filter, commercial ad, split screen, redesigned product, extra fingers, third-person photo, DSLR portrait, photographer standing in front of subject.

"videoPrompt" (ENGLISH): Selfie Talking Head (${secs}s) for a Meta Ads Reel: 9:16 iPhone front-camera selfie talking-head of this SAME person holding one product bag speaking "<the script line below, in the ad's language>", engaging eye contact with the lens, natural gestures, daytime white balance, sharp background, handheld. The generated video includes 2 B-rolls: (1) a product-only cutaway showing ALL the products of the combo TOGETHER on a table (every bag visible and readable), daytime white balance; then (2) the same person using/enjoying the product naturally, handheld, not a showroom. Keep every product's packaging identical across all frames.

"script": una frase corta, natural y vendedora en español rioplatense que la persona dice a cámara sobre el producto (con un CTA al final).`,
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
    // Guion final: el elegido por el usuario (variación del paquete) o el que armó el Prompt Master.
    const finalScript = input.scriptOverride?.trim() || plan.script;
    const spoken = finalScript ? ` The person says in Spanish: "${finalScript}".` : '';
    // Seedance SIEMPRE sin su audio (ruido ambiente). Si la calidad pide audio, le
    // ponemos LOCUCIÓN (TTS del guion) y la mezclamos → la persona "dice" el guion.
    const vid = await this.videoProvider.generate({
      image: img.dataUrl,
      prompt: `${plan.videoPrompt || 'natural UGC selfie, person talking to camera holding the product'}${spoken} ${UGC_VIDEO_DIRECTIVE}`,
      duration: secs, resolution: q.resolution, audio: false,
    });
    const videoUrl = q.audio
      ? await this.muxVoiceover(vid.url, finalScript, this.voiceKeyFor(input.avatarDesc))
      : await this.persist(vid.url, 'video');
    return {
      productData, imagePrompt: plan.imagePrompt, videoPrompt: plan.videoPrompt, script: finalScript,
      imageUrl, videoUrl, model: vid.model, seconds: vid.seconds,
    };
  }

  // Voz según el género de la persona (del avatarDesc). Default: femenina natural.
  private voiceKeyFor(avatarDesc?: string): string {
    const g = (avatarDesc || '').toLowerCase();
    if (/\b(hombre|masculino|var[oó]n|chico|muchacho|masc|male|se[ñn]or)\b/.test(g)) return 'masc_natural';
    return 'fem_natural';
  }

  // Mezcla una locución (TTS del guion) sobre el video → la persona "dice" el guion.
  private async muxVoiceover(videoUrl: string, script?: string, voiceKey = 'fem_natural'): Promise<string> {
    if (!script?.trim()) return this.persist(videoUrl, 'video');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vo_'));
    try {
      const dv = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 120_000 });
      const vf = path.join(tmp, 'v.mp4'); fs.writeFileSync(vf, Buffer.from(dv.data as ArrayBuffer));
      const speech = await this.openai.speech(script, voiceKey);
      const ab = speech.replace(/^data:audio\/\w+;base64,/, '');
      const af = path.join(tmp, 'a.mp3'); fs.writeFileSync(af, Buffer.from(ab, 'base64'));
      const out = path.join(tmp, 'out.mp4');
      await new Promise<void>((res, rej) => {
        ffmpeg().input(vf).input(af)
          .outputOptions(['-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart'])
          .output(out).on('end', () => res()).on('error', err => rej(err)).run();
      });
      const b64 = fs.readFileSync(out).toString('base64');
      return await this.persist(`data:video/mp4;base64,${b64}`, 'video');
    } catch (e: any) {
      this.logger.warn(`muxVoiceover falló (${e.message}) — devuelvo video sin voz`);
      return this.persist(videoUrl, 'video');
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  // ── MOTOR DE AD-PACKAGE: de un producto → paquete publicitario completo ──────
  // hooks, guion de voz, prompt de imagen, prompt de video (Seedance), copy y 3 variaciones.
  // Todo en español (AR), producto EXACTO, orientado a conversión. Una sola llamada a OpenAI.
  async generateAdPackage(input: { product: ProductInfo; referenceImage?: string; referenceImages?: string[]; avatarUsar?: boolean; seconds?: number }) {
    const pic = (input.referenceImages?.length ? input.referenceImages[0] : input.referenceImage) || undefined;
    const { truth } = await this.extractProductTruth(pic);
    const secs = Math.min(10, Math.max(6, input.seconds ?? 8));
    const avatar = input.avatarUsar !== false; // por defecto incluye persona
    const pkg = await this.openai.chatJSON<any>(
      'Sos un COPYWRITER SENIOR de performance marketing (10+ años en e-commerce, Meta/TikTok Ads Argentina) y actuás como MOTOR backend: devolvés SOLO JSON estricto, sin charlar. Escribís copy PROFESIONAL y pulido: ganchos potentes que frenan el scroll, beneficios concretos (no genéricos ni cliché), lenguaje natural rioplatense creíble (nada robótico ni de traductor), y un CTA claro. Reglas: nunca modificar el diseño del producto, nunca inventar características (basate SOLO en el JSON), SIEMPRE audio con voz, estilo performance real (no cine), foco absoluto en CONVERSIÓN. Evitá: signos de exclamación de más, mayúsculas gritadas, promesas vacías, relleno. Guiones cortos y con ritmo (6-10s). Si falta info, autocompletá con criterio profesional.',
      `INPUT producto: ${JSON.stringify(input.product)}.${truth}\nAvatar/persona en video: ${avatar ? 'SÍ (mostrar interacción humana con el producto)' : 'NO (solo producto + voz en off)'}. Duración objetivo: ${secs}s. 9:16 vertical.

Generá el paquete y devolvé SOLO este JSON (todo en español AR, salvo las secciones técnicas de los video_prompt que van en inglés PERO con el "Voice script" citado en español):
{
  "hooks": ["curiosidad (<8 palabras)", "problema-solución (<8)", "oferta (<8)"],
  "voice_script": "guion 6-10s: gancho(2s) + beneficio principal + beneficio secundario + CTA. Español natural, vendedor.",
  "image_prompt": "prompt para IA de imagen: escena realista comercial, producto EXACTO del JSON, fondo contextual, iluminación comercial, con textos de venta EN ESPAÑOL (titular/precio si hay/beneficios), estilo MercadoLibre/Meta Ads.",
  "video_prompt": "prompt Seedance con este formato EXACTO: 'Use @Image1 as the exact product reference. Do not modify the product in any way. Scene: <...>. Action: <human interaction with the product>. Camera: medium shot, slow push-in, detail close-up. Lighting: natural realistic commercial. Style: UGC Meta Ads, not cinematic. Audio: Spanish (Argentina), clear human voice, subtle ambient. Voice script: \\"<voice_script>\\". The video MUST include audible voice narration, NOT silent. Constraints: no product deformation, no extra objects, no burned subtitles, no english text, realistic physics. Format: 9:16, ${secs}s, 1080p.'",
  "copy": { "headline": "titular (<6 palabras)", "text": "texto primario 1-2 líneas", "cta": "CTA corto" },
  "variations": {
    "ugc": { "video_prompt": "variante UGC: persona hablando a cámara e interactuando con el producto", "voice_script": "guion UGC" },
    "demo": { "video_prompt": "variante DEMO: sin persona, foco en el uso del producto, solo voz en off", "voice_script": "guion demo" },
    "hard_sell": { "video_prompt": "variante HARD SELL: oferta agresiva, foco en el precio, ritmo rápido", "voice_script": "guion hard sell con precio" }
  }
}`,
      1500,
    );
    return pkg;
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
