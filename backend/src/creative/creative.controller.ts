import { Controller, Get, Post, Delete, Body, Param, Request, UseGuards, HttpCode, HttpStatus, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreativeService, ProductInfo } from './creative.service';
import { CreditsService } from '../credits/credits.service';
import { CostTrackingService } from '../credits/cost-tracking.service';
import { CREDIT_COSTS, estimateProviderCost, CreditOperation } from '../config/credits.config';
import { PROVIDERS } from '../config/providers.config';
import { CREATOR_PRESETS } from './creators.config';
import { Fmt } from './openai.service';

@ApiTags('creative')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('creative')
export class CreativeController {
  constructor(
    private readonly svc: CreativeService,
    private readonly credits: CreditsService,
    private readonly cost: CostTrackingService,
  ) {}

  // Wrapper reserva → genera → consume/release + cost tracking (créditos seguros)
  private async billed<T>(req: any, opts: {
    operation: CreditOperation; amount: number; provider: string; model: string; seconds?: number;
  }, fn: () => Promise<T>): Promise<{ result: T; credits: number; creditsUsed: number }> {
    // 🔒 Candado duro de gasto: si el gasto real de IA del mes superó el tope, se bloquea.
    const cap = Number(process.env.MAX_AI_SPEND_MONTH_USD ?? 15);
    if (cap > 0) {
      const spent = await this.cost.monthlySpendUsd();
      if (spent >= cap) {
        throw new ForbiddenException(`Tope de gasto de IA del mes alcanzado ($${spent.toFixed(2)} de $${cap}). Subí el límite (MAX_AI_SPEND_MONTH_USD) para seguir generando.`);
      }
    }
    const idem = req.headers['idempotency-key'] as string | undefined;
    const { txId } = await this.credits.reserve({
      userId: req.user.id, role: req.user.role, amount: opts.amount,
      operation: opts.operation, provider: opts.provider, model: opts.model, idempotencyKey: idem,
    });
    try {
      const result = await fn();
      await this.credits.consume(txId);
      await this.cost.log({
        userId: req.user.id, provider: opts.provider, model: opts.model, operation: opts.operation,
        durationSecs: opts.seconds, resolution: opts.seconds ? '1080p' : undefined,
        estimatedProviderCostUsd: estimateProviderCost(opts.operation, opts.seconds),
        creditsReserved: opts.amount, creditsConsumed: opts.amount, status: 'completed',
      });
      return { result, credits: await this.credits.balance(req.user.id), creditsUsed: req.user.role === 'admin' ? 0 : opts.amount };
    } catch (e: any) {
      await this.credits.release(txId, 'gen_error');
      await this.cost.log({ userId: req.user.id, provider: opts.provider, model: opts.model, operation: opts.operation, status: 'failed', error: e?.message?.slice(0, 200) });
      throw e;
    }
  }

  // Límites del plan gratis: 2 imágenes en total y sin video (hasta recargar créditos).
  private static readonly FREE_IMAGE_LIMIT = 2;
  private async assertFree(req: any, kind: 'image' | 'video'): Promise<{ free: boolean; remaining: number }> {
    const free = await this.credits.isFreeUser(req.user.id, req.user.role);
    if (!free) return { free: false, remaining: Infinity };
    if (kind === 'video') throw new ForbiddenException('Los videos están disponibles al recargar créditos. El plan gratis incluye 2 imágenes.');
    const remaining = CreativeController.FREE_IMAGE_LIMIT - await this.credits.imageCount(req.user.id);
    if (remaining <= 0) throw new ForbiddenException('Alcanzaste el límite de 2 imágenes del plan gratis. Recargá créditos para seguir generando.');
    return { free: true, remaining };
  }

  @Get('costs')
  async costs(@Request() req: any) { return { costs: CREDIT_COSTS, credits: await this.credits.balance(req.user.id) }; }

  // PASO 1 (gratis)
  @Post('analyze') @HttpCode(HttpStatus.OK)
  async analyze(@Body() body: { name?: string; description?: string; imageBase64?: string }) {
    return this.svc.analyzeProduct(body);
  }

  // PASO 2+3 (gratis)
  @Post('strategy') @HttpCode(HttpStatus.OK)
  async strategy(@Body() body: { product: ProductInfo; objective: string; style: string }) {
    return this.svc.buildStrategy(body);
  }

  // PASO 4 — 3 variantes
  @Post('images') @HttpCode(HttpStatus.OK)
  @Throttle({ medium: { limit: 15, ttl: 60000 } })
  async images(@Body() body: { product: ProductInfo; objective: string; style: string; format: Fmt; quality?: 'standard' | 'premium'; referenceImage?: string; referenceImages?: string[]; brief?: string }, @Request() req: any) {
    const { remaining } = await this.assertFree(req, 'image');
    const op: CreditOperation = body.quality === 'premium' ? 'image_premium' : 'image_standard';
    const count = Math.min(3, remaining);
    const amount = CREDIT_COSTS[op] * count;
    const { result, credits, creditsUsed } = await this.billed(req, { operation: op, amount, provider: PROVIDERS.image, model: PROVIDERS.openaiImageModel },
      () => this.svc.generateImageVariants(body, count));
    return { variants: result, credits, creditsUsed };
  }

  // Regenerar una variante
  @Post('image') @HttpCode(HttpStatus.OK)
  async image(@Body() body: { product: ProductInfo; objective: string; style: string; format: Fmt; angleKey?: string; quality?: 'standard' | 'premium'; referenceImage?: string; referenceImages?: string[]; brief?: string }, @Request() req: any) {
    await this.assertFree(req, 'image');
    const op: CreditOperation = body.quality === 'premium' ? 'image_premium' : 'image_standard';
    const { result, credits, creditsUsed } = await this.billed(req, { operation: op, amount: CREDIT_COSTS[op], provider: PROVIDERS.image, model: PROVIDERS.openaiImageModel },
      () => this.svc.generateSingleImage(body));
    return { variant: result, credits, creditsUsed };
  }

  // PASO 5 — video
  @Post('video') @HttpCode(HttpStatus.OK)
  @Throttle({ medium: { limit: 10, ttl: 60000 } })
  async video(@Body() body: { imageBase64: string; product: ProductInfo; style: string; duration: '5' | '10' }, @Request() req: any) {
    await this.assertFree(req, 'video');
    const seconds = body.duration === '10' ? 10 : 5;
    const op: CreditOperation = seconds === 10 ? 'video_10' : 'video_5';
    const { result, credits, creditsUsed } = await this.billed(req, { operation: op, amount: CREDIT_COSTS[op], provider: PROVIDERS.video, model: PROVIDERS.seedance.model, seconds },
      () => this.svc.generateVideo(body));
    const r = result as any;
    this.svc.saveCreative(req.user.id, {
      name: `Video — ${body?.product?.name ?? 'producto'}`, type: 'video',
      videoUrl: r.videoUrl, studio: { product: body?.product }, creditsUsed,
    }).catch(() => { /* no bloquea */ });
    return { ...r, credits, creditsUsed };
  }

  // PASO 6 — copy (gratis para el usuario; registramos su costo real de IA)
  @Post('copy') @HttpCode(HttpStatus.OK)
  async copy(@Body() body: { product: ProductInfo; objective: string; style: string }, @Request() req: any) {
    const variants = await this.svc.generateCopy(body);
    await this.cost.log({ userId: req.user.id, provider: PROVIDERS.copy, model: PROVIDERS.openaiChatModel, operation: 'copy', estimatedProviderCostUsd: estimateProviderCost('copy'), creditsConsumed: 0, status: 'completed' });
    return { variants };
  }

  // ── UGC (persona IA) ─────────────────────────────────────────────────────────
  @Get('creators')
  creators() { return { creators: CREATOR_PRESETS }; }

  // Auto-selección de creator/escena/guion (gratis)
  @Post('ugc-auto') @HttpCode(HttpStatus.OK)
  async ugcAuto(@Body() body: { product: ProductInfo }) { return this.svc.pickUGC(body.product); }

  // Genera UGC (imagen persona sintética + video). Cuesta ugc_video_10.
  @Post('ugc') @HttpCode(HttpStatus.OK)
  @Throttle({ medium: { limit: 8, ttl: 60000 } })
  async ugc(@Body() body: any, @Request() req: any) {
    await this.assertFree(req, 'video');
    const { result, credits, creditsUsed } = await this.billed(req,
      { operation: 'ugc_video_10', amount: CREDIT_COSTS.ugc_video_10, provider: PROVIDERS.video, model: PROVIDERS.seedance.model, seconds: 10 },
      () => this.svc.generateUGC(body));
    return { ...(result as any), credits, creditsUsed };
  }

  // ── Campaña UGC (agente planifica escenas tipo nodos) ───────────────────────
  @Post('ugc-campaign/plan') @HttpCode(HttpStatus.OK)
  async ugcPlan(@Body() body: { product: ProductInfo; creatorKey?: string }) { return this.svc.planUGCCampaign(body.product, body.creatorKey); }

  // Genera una escena de la campaña (imagen + video). Cuesta ugc_video_10.
  @Post('ugc-campaign/scene') @HttpCode(HttpStatus.OK)
  @Throttle({ medium: { limit: 12, ttl: 60000 } })
  async ugcScene(@Body() body: any, @Request() req: any) {
    // Si Seedance no está configurado, la escena genera SOLO la imagen → se cobra
    // como imagen (no como video-UGC). Así no perdés plata por videos que no salen.
    const hasVideo = this.svc.videoAvailable;
    await this.assertFree(req, hasVideo ? 'video' : 'image');
    const billing = hasVideo
      ? { operation: 'ugc_video_10' as CreditOperation, amount: CREDIT_COSTS.ugc_video_10, provider: PROVIDERS.video, model: PROVIDERS.seedance.model, seconds: 10 }
      : { operation: 'image_standard' as CreditOperation, amount: CREDIT_COSTS.image_standard, provider: PROVIDERS.image, model: PROVIDERS.openaiImageModel };
    const { result, credits, creditsUsed } = await this.billed(req, billing, () => this.svc.generateUGCScene(body));
    // Auto-guardar la escena en el historial para que NO se pierda (fire-and-forget)
    const r = result as any;
    this.svc.saveCreative(req.user.id, {
      name: `Escena ${body?.scene?.title ?? body?.scene?.key ?? ''} — ${body?.product?.name ?? 'UGC'}`.trim(),
      format: body?.format ?? '9:16', type: r.videoUrl ? 'video' : 'image',
      imageUrl: r.imageUrl, videoUrl: r.videoUrl, studio: { scene: body?.scene, product: body?.product }, creditsUsed,
    }).catch(() => { /* no bloquea la respuesta */ });
    return { ...r, credits, creditsUsed };
  }

  // Texto a voz (TTS real). Gratis para el usuario; registramos su costo real de IA.
  @Post('tts') @HttpCode(HttpStatus.OK)
  async tts(@Body() body: { text: string; voice?: string }, @Request() req: any) {
    const r = await this.svc.generateVoice(body.text, body.voice);
    await this.cost.log({ userId: req.user.id, provider: 'openai', model: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts', operation: 'tts', estimatedProviderCostUsd: estimateProviderCost('tts'), creditsConsumed: 0, status: 'completed' });
    return r;
  }

  // Ensamblar el video final de la campaña (une las escenas). Gratis (solo cómputo).
  @Post('ugc-campaign/assemble') @HttpCode(HttpStatus.OK)
  @Throttle({ medium: { limit: 6, ttl: 60000 } })
  async assemble(@Body() body: { videoUrls: string[]; musicUrl?: string }) { return this.svc.assembleFinalVideo(body.videoUrls, body.musicUrl); }

  @Post(':id/favorite') @HttpCode(HttpStatus.OK)
  async favorite(@Param('id') id: string, @Request() req: any) { return this.svc.toggleFavorite(id, req.user.id); }

  // HISTORIAL
  @Post() @HttpCode(HttpStatus.CREATED)
  async save(@Body() body: any, @Request() req: any) { return this.svc.saveCreative(req.user.id, body); }

  @Get()
  async list(@Request() req: any) { return this.svc.listCreatives(req.user.id); }

  @Get('stats')
  async stats(@Request() req: any) { return this.svc.stats(req.user.id); }

  @Get(':id')
  async getOne(@Param('id') id: string, @Request() req: any) {
    if (!id) throw new BadRequestException('id requerido');
    return this.svc.getCreative(id, req.user.id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) { return this.svc.removeCreative(id, req.user.id); }
}
