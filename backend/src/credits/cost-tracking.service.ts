import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';

export interface GenerationLog {
  userId: string; campaignId?: string; creativeId?: string;
  provider: string; model: string; operation: string;
  durationSecs?: number; resolution?: string;
  estimatedProviderCostUsd?: number; creditsReserved?: number; creditsConsumed?: number;
  status: 'completed' | 'failed'; error?: string;
}

// Registro de costos REALES de proveedor (solo lo ve el admin, para el margen).
@Injectable()
export class CostTrackingService {
  constructor(@Inject(DATABASE_POOL) private readonly db: Pool) {}

  async log(g: GenerationLog): Promise<void> {
    await this.db.query(
      `INSERT INTO ai_generations
        (user_id, campaign_id, creative_id, provider, model, operation, duration_secs, resolution,
         estimated_provider_cost_usd, credits_reserved, credits_consumed, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [g.userId, g.campaignId ?? null, g.creativeId ?? null, g.provider, g.model, g.operation,
       g.durationSecs ?? null, g.resolution ?? null, g.estimatedProviderCostUsd ?? 0,
       g.creditsReserved ?? 0, g.creditsConsumed ?? 0, g.status, g.error ?? null],
    ).catch(() => { /* logging no debe romper la generación */ });
  }

  // Métricas para el ADMIN cost dashboard
  // Gasto real de IA del mes en USD (para el tope duro que bloquea generación).
  async monthlySpendUsd(): Promise<number> {
    try {
      const { rows } = await this.db.query(
        `SELECT COALESCE(SUM(estimated_provider_cost_usd),0)::float AS c
         FROM ai_generations WHERE created_at >= date_trunc('month', now())`);
      return rows[0]?.c ?? 0;
    } catch { return 0; }
  }

  async adminMetrics() {
    const { rows } = await this.db.query(`
      SELECT
        COALESCE(SUM(estimated_provider_cost_usd),0)::float AS ai_cost_usd,
        COALESCE(SUM(credits_consumed),0)::int AS credits_used,
        COUNT(*) FILTER (WHERE operation LIKE 'image%')::int AS images,
        COUNT(*) FILTER (WHERE operation LIKE '%video%')::int AS videos,
        COUNT(*) FILTER (WHERE status='failed')::int AS failed,
        COUNT(DISTINCT user_id)::int AS active_users
      FROM ai_generations`);
    const { rows: byModel } = await this.db.query(
      `SELECT provider, model, COUNT(*)::int AS n, COALESCE(SUM(estimated_provider_cost_usd),0)::float AS cost
       FROM ai_generations GROUP BY provider, model ORDER BY n DESC LIMIT 20`);

    // Extras defensivos: gasto del mes + ingreso real por recargas aprobadas (no rompen si fallan)
    let extra: Record<string, number> = {};
    try {
      const { rows: mo } = await this.db.query(
        `SELECT COALESCE(SUM(estimated_provider_cost_usd),0)::float AS ai_cost_month_usd,
                COALESCE(SUM(credits_consumed),0)::int AS credits_month
         FROM ai_generations WHERE created_at >= date_trunc('month', now())`);
      extra = { ...extra, ...mo[0] };
    } catch { /* ignore */ }
    try {
      const { rows: rev } = await this.db.query(
        `SELECT COALESCE(SUM(amount_usd),0)::float AS revenue_usd,
                COUNT(*)::int AS topups_approved,
                COUNT(DISTINCT user_id)::int AS paying_users
         FROM credit_purchases WHERE status='approved'`);
      const { rows: revM } = await this.db.query(
        `SELECT COALESCE(SUM(amount_usd),0)::float AS revenue_month_usd
         FROM credit_purchases WHERE status='approved' AND reviewed_at >= date_trunc('month', now())`);
      extra = { ...extra, ...rev[0], ...revM[0] };
    } catch { /* ignore */ }

    // Gasto real de la IA por día (últimos 30) y por operación — para la tabla del panel
    let byDay: any[] = [];
    let byOperation: any[] = [];
    try {
      byDay = (await this.db.query(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                COUNT(*)::int AS n,
                COALESCE(SUM(estimated_provider_cost_usd),0)::float AS cost
         FROM ai_generations
         WHERE created_at >= now() - interval '30 days'
         GROUP BY 1 ORDER BY 1 DESC`)).rows;
    } catch { /* ignore */ }
    try {
      byOperation = (await this.db.query(
        `SELECT operation,
                COUNT(*)::int AS n,
                COALESCE(SUM(estimated_provider_cost_usd),0)::float AS cost
         FROM ai_generations GROUP BY operation ORDER BY cost DESC`)).rows;
    } catch { /* ignore */ }

    return { ...rows[0], ...extra, byModel, byDay, byOperation };
  }
}
