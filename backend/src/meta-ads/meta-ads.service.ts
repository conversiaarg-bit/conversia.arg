import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import axios from 'axios';
import { DATABASE_POOL } from '../database/database.module';
import { EncryptionService } from '../common/services/encryption.service';

@Injectable()
export class MetaAdsService {
  private readonly logger = new Logger(MetaAdsService.name);
  private readonly apiVersion: string;
  private readonly baseUrl: string;

  constructor(
    @Inject(DATABASE_POOL) private readonly db: Pool,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {
    this.apiVersion = this.config.get<string>('meta.apiVersion', 'v19.0');
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  private api(accessToken: string) {
    return axios.create({
      baseURL: this.baseUrl,
      params: { access_token: accessToken },
    });
  }

  // Decrypts a stored token before using it with the Meta API
  private apiWithStoredToken(encryptedToken: string) {
    return this.api(this.encryption.decrypt(encryptedToken));
  }

  // ── Validate & save Meta account ──────────────────────────────────────────

  async connectAccount(userId: string, dto: {
    accessToken: string;
    adAccountId: string;
    businessId?: string;
    pixelId?: string;
    pageId?: string;
    instagramAccountId?: string;
    whatsappNumber?: string;
    name: string;
  }) {
    // Validate token
    const client = this.api(dto.accessToken);
    try {
      const tokenInfo = await client.get('/me', {
        params: { fields: 'id,name,email' },
      });
      this.logger.log(`Meta token valid for: ${tokenInfo.data.name}`);
    } catch {
      throw new BadRequestException('Token de Meta inválido o expirado');
    }

    // Validate ad account access
    try {
      await client.get(`/act_${dto.adAccountId.replace('act_', '')}`, {
        params: { fields: 'id,name,account_status,currency' },
      });
    } catch {
      throw new BadRequestException('No se puede acceder a la cuenta publicitaria. Verificá el ID y los permisos.');
    }

    // Upsert meta account
    const { rows } = await this.db.query(
      `INSERT INTO meta_accounts
         (user_id, name, meta_ad_account_id, meta_business_id, meta_pixel_id,
          meta_page_id, instagram_account_id, whatsapp_number, access_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, meta_ad_account_id) DO UPDATE SET
         name = EXCLUDED.name,
         meta_business_id = EXCLUDED.meta_business_id,
         meta_pixel_id = EXCLUDED.meta_pixel_id,
         meta_page_id = EXCLUDED.meta_page_id,
         instagram_account_id = EXCLUDED.instagram_account_id,
         whatsapp_number = EXCLUDED.whatsapp_number,
         access_token = EXCLUDED.access_token,
         is_active = TRUE, updated_at = NOW()
       RETURNING id`,
      [
        userId, dto.name, dto.adAccountId.replace('act_', ''),
        dto.businessId ?? null, dto.pixelId ?? null, dto.pageId ?? null,
        dto.instagramAccountId ?? null, dto.whatsappNumber ?? null,
        this.encryption.encrypt(dto.accessToken),
      ],
    );

    return { id: rows[0].id, message: 'Cuenta Meta conectada correctamente' };
  }

  // ── Create campaign on Meta ───────────────────────────────────────────────

  async publishCampaign(campaignId: string, userId: string) {
    const campResult = await this.db.query(
      `SELECT c.*, ma.access_token, ma.meta_ad_account_id, ma.whatsapp_number,
              ma.meta_page_id, ma.meta_pixel_id
       FROM campaigns c
       JOIN meta_accounts ma ON ma.id = c.meta_account_id
       WHERE c.id = $1 AND c.user_id = $2`,
      [campaignId, userId],
    );
    if (campResult.rows.length === 0) throw new BadRequestException('Campaña no encontrada');
    const campaign = campResult.rows[0];

    const client = this.apiWithStoredToken(campaign.access_token);
    const adAccountId = `act_${campaign.meta_ad_account_id}`;

    try {
      // 1. Create Campaign
      const campaignRes = await client.post(`/${adAccountId}/campaigns`, {
        name: campaign.name,
        objective: 'MESSAGES',
        status: 'ACTIVE',
        special_ad_categories: [],
      });
      const metaCampaignId = campaignRes.data.id;
      this.logger.log(`Meta campaign created: ${metaCampaignId}`);

      // 2. Create Ad Set
      const adSetRes = await client.post(`/${adAccountId}/adsets`, {
        name: `${campaign.name} — Ad Set`,
        campaign_id: metaCampaignId,
        daily_budget: campaign.daily_budget_cents * 10, // Meta uses microcents/10
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'CONVERSATIONS',
        status: 'ACTIVE',
        targeting: campaign.targeting ?? {
          age_min: 18,
          age_max: 65,
          geo_locations: { countries: ['AR'] },
        },
        messenger_destination_type: 'WHATSAPP',
        promoted_object: campaign.meta_pixel_id
          ? { pixel_id: campaign.meta_pixel_id, custom_event_type: 'CONTACT' }
          : undefined,
      });
      const metaAdSetId = adSetRes.data.id;

      // 3. Create Creative (placeholder — real implementation uses uploaded media)
      const creativeRes = await client.post(`/${adAccountId}/adcreatives`, {
        name: `${campaign.name} — Creative`,
        object_story_spec: {
          page_id: campaign.meta_page_id,
          link_data: {
            message: campaign.ai_copy_headline ?? campaign.name,
            call_to_action: {
              type: 'WHATSAPP_MESSAGE',
              value: {
                app_destination: 'WHATSAPP',
                whatsapp_number: campaign.whatsapp_number,
              },
            },
          },
        },
      });

      // 4. Create Ad
      const adRes = await client.post(`/${adAccountId}/ads`, {
        name: `${campaign.name} — Ad`,
        adset_id: metaAdSetId,
        creative: { creative_id: creativeRes.data.id },
        status: 'ACTIVE',
      });

      // Save Meta IDs
      await this.db.query(
        `UPDATE campaigns SET
           meta_campaign_id = $1, meta_adset_id = $2, meta_ad_id = $3,
           status = 'active', published_at = NOW(), updated_at = NOW()
         WHERE id = $4`,
        [metaCampaignId, metaAdSetId, adRes.data.id, campaignId],
      );

      return {
        metaCampaignId,
        metaAdSetId,
        metaAdId: adRes.data.id,
        message: 'Campaña publicada en Meta Ads exitosamente',
      };
    } catch (err: any) {
      const msg = err.response?.data?.error?.message ?? err.message;
      await this.db.query(
        "UPDATE campaigns SET status = 'error', updated_at = NOW() WHERE id = $1",
        [campaignId],
      );
      throw new BadRequestException(`Error al publicar en Meta: ${msg}`);
    }
  }

  // ── Sync metrics from Meta ────────────────────────────────────────────────

  async syncCampaignMetrics(campaignId: string) {
    const campResult = await this.db.query(
      `SELECT c.meta_campaign_id, ma.access_token
       FROM campaigns c
       JOIN meta_accounts ma ON ma.id = c.meta_account_id
       WHERE c.id = $1 AND c.meta_campaign_id IS NOT NULL`,
      [campaignId],
    );
    if (campResult.rows.length === 0) return;

    const { meta_campaign_id, access_token } = campResult.rows[0];
    const client = this.apiWithStoredToken(access_token);

    try {
      const insightsRes = await client.get(`/${meta_campaign_id}/insights`, {
        params: {
          fields: 'impressions,clicks,ctr,cpc,cpm,spend,actions',
          date_preset: 'last_30d',
        },
      });

      const data = insightsRes.data.data[0];
      if (!data) return;

      const leads = (data.actions ?? [])
        .filter((a: any) => a.action_type === 'onsite_conversion.messaging_conversation_started_7d')
        .reduce((sum: number, a: any) => sum + parseInt(a.value), 0);

      const spentCents = Math.round(parseFloat(data.spend ?? '0') * 100);

      await this.db.query(
        `UPDATE campaigns SET
           impressions = $1, clicks = $2, ctr = $3,
           cpc_cents = $4, cpm_cents = $5, total_spent_cents = $6,
           leads = $7, metrics_updated_at = NOW(), updated_at = NOW()
         WHERE id = $8`,
        [
          parseInt(data.impressions ?? '0'),
          parseInt(data.clicks ?? '0'),
          parseFloat(data.ctr ?? '0'),
          Math.round(parseFloat(data.cpc ?? '0') * 100),
          Math.round(parseFloat(data.cpm ?? '0') * 100),
          spentCents,
          leads,
          campaignId,
        ],
      );
    } catch (err: any) {
      this.logger.error(`Failed to sync metrics for campaign ${campaignId}: ${err.message}`);
    }
  }

  // ── Pause / Resume ────────────────────────────────────────────────────────

  async toggleCampaign(campaignId: string, userId: string, action: 'pause' | 'resume') {
    const campResult = await this.db.query(
      `SELECT c.meta_campaign_id, ma.access_token
       FROM campaigns c
       JOIN meta_accounts ma ON ma.id = c.meta_account_id
       WHERE c.id = $1 AND c.user_id = $2 AND c.meta_campaign_id IS NOT NULL`,
      [campaignId, userId],
    );
    if (campResult.rows.length === 0) throw new BadRequestException('Campaña no encontrada o no publicada');

    const { meta_campaign_id, access_token } = campResult.rows[0];
    const status = action === 'pause' ? 'PAUSED' : 'ACTIVE';

    await this.apiWithStoredToken(access_token).post(`/${meta_campaign_id}`, { status });
    await this.db.query(
      `UPDATE campaigns SET status = $1, updated_at = NOW() WHERE id = $2`,
      [action === 'pause' ? 'paused' : 'active', campaignId],
    );

    return { message: `Campaña ${action === 'pause' ? 'pausada' : 'activada'}` };
  }

  // ── OAuth con Facebook (conectar Meta desde adentro de Conversia) ─────────

  private get appId() { return this.config.get<string>('meta.appId', ''); }
  private get appSecret() { return this.config.get<string>('meta.appSecret', ''); }
  private get frontendUrl() { return this.config.get<string>('frontendUrl', ''); }
  // La URL del backend se detecta del request (o BACKEND_URL si está); no hay que configurarla.
  private redirectUri(backendBase: string) { return `${backendBase}/api/v1/meta-ads/oauth/callback`; }

  // 1) URL del diálogo de login de Facebook (el usuario la abre y autoriza).
  oauthUrl(userId: string, backendBase: string): { url: string } {
    if (!this.appId) throw new BadRequestException('Meta no está configurado en el servidor (falta META_APP_ID).');
    const state = this.encryption.encrypt(`${userId}:${Date.now()}`);
    const configId = this.config.get<string>('meta.loginConfigId', '');
    let url = `https://www.facebook.com/${this.apiVersion}/dialog/oauth`
      + `?client_id=${encodeURIComponent(this.appId)}`
      + `&redirect_uri=${encodeURIComponent(this.redirectUri(backendBase))}`
      + `&state=${encodeURIComponent(state)}`
      + `&response_type=code`;
    if (configId) {
      // "Inicio de sesión con Facebook para empresas": los permisos van en la configuración
      url += `&config_id=${encodeURIComponent(configId)}`;
    } else {
      // Login clásico por scopes
      url += `&scope=${encodeURIComponent(['ads_management', 'ads_read', 'pages_show_list', 'pages_read_engagement', 'business_management'].join(','))}`;
    }
    return { url };
  }

  private readState(state: string): string {
    const [userId, ts] = this.encryption.decrypt(state).split(':');
    if (!userId || !ts || Date.now() - Number(ts) > 15 * 60 * 1000) {
      throw new BadRequestException('Sesión de conexión inválida o expirada. Intentá de nuevo.');
    }
    return userId;
  }

  private async saveOauthAccount(userId: string, name: string, adAccountId: string, pageId: string | null, encToken: string) {
    await this.db.query(
      `INSERT INTO meta_accounts (user_id, name, meta_ad_account_id, meta_page_id, access_token)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, meta_ad_account_id) DO UPDATE SET
         name = EXCLUDED.name, meta_page_id = EXCLUDED.meta_page_id,
         access_token = EXCLUDED.access_token, is_active = TRUE, updated_at = NOW()`,
      [userId, name, adAccountId, pageId, encToken],
    );
  }

  // 2) Callback: canjea el código por un token de larga duración, trae las cuentas
  //    publicitarias y páginas, guarda la primera y redirige al frontend.
  async oauthCallback(code: string, state: string, backendBase: string, fbError?: string): Promise<string> {
    const fe = this.frontendUrl;
    const back = (m: string, extra = '') => `${fe}/dashboard/integrations?meta=${m}${extra}`;
    // Meta volvió con un error (o sin code/state) → mostramos un mensaje claro, no crasheamos.
    if (fbError) return back('error', `&msg=${encodeURIComponent(fbError)}`);
    if (!code || !state) return back('error', `&msg=${encodeURIComponent('Meta no devolvió el código de autorización. Falta autorizar la URI de redirección en el login de la app.')}`);
    try {
      const userId = this.readState(state);
      // código -> token corto
      const short = (await axios.get(`${this.baseUrl}/oauth/access_token`, {
        params: { client_id: this.appId, client_secret: this.appSecret, redirect_uri: this.redirectUri(backendBase), code },
      })).data.access_token;
      // token corto -> token de larga duración (~60 días, renovable)
      const long = (await axios.get(`${this.baseUrl}/oauth/access_token`, {
        params: { grant_type: 'fb_exchange_token', client_id: this.appId, client_secret: this.appSecret, fb_exchange_token: short },
      })).data.access_token;

      const client = this.api(long);
      const accounts = (await client.get('/me/adaccounts', { params: { fields: 'id,name,account_status', limit: 100 } })).data.data ?? [];
      const pages = (await client.get('/me/accounts', { params: { fields: 'id,name', limit: 100 } })).data.data ?? [];
      if (!accounts.length) return back('error', `&msg=${encodeURIComponent('Tu cuenta de Meta no tiene cuentas publicitarias accesibles.')}`);

      const acct = accounts[0];
      const adId = String(acct.id).replace('act_', '');
      await this.saveOauthAccount(userId, acct.name || 'Meta', adId, pages[0]?.id ?? null, this.encryption.encrypt(long));
      // si hay más de una cuenta/página, el frontend ofrece elegir
      const multi = accounts.length > 1 || pages.length > 1 ? '&select=1' : '';
      return back('connected', `&name=${encodeURIComponent(acct.name || 'Meta')}${multi}`);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? err.message ?? 'No se pudo conectar con Meta';
      this.logger.error(`OAuth Meta falló: ${msg}`);
      return back('error', `&msg=${encodeURIComponent(msg)}`);
    }
  }

  // 3) Lista las cuentas publicitarias y páginas del token conectado (para elegir).
  async listAssets(userId: string) {
    const { rows } = await this.db.query(
      `SELECT access_token FROM meta_accounts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`, [userId],
    );
    if (!rows.length) throw new BadRequestException('No hay una cuenta de Meta conectada.');
    const client = this.apiWithStoredToken(rows[0].access_token);
    const adAccounts = (await client.get('/me/adaccounts', { params: { fields: 'id,name,account_status', limit: 100 } })).data.data ?? [];
    const pages = (await client.get('/me/accounts', { params: { fields: 'id,name', limit: 100 } })).data.data ?? [];
    return { adAccounts, pages };
  }

  // 4) Fija qué cuenta publicitaria + página usar (reutiliza el token conectado).
  async selectAccount(userId: string, adAccountId: string, pageId?: string) {
    const { rows } = await this.db.query(
      `SELECT access_token FROM meta_accounts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`, [userId],
    );
    if (!rows.length) throw new BadRequestException('No hay una cuenta de Meta conectada.');
    const token = rows[0].access_token;
    const adId = String(adAccountId).replace('act_', '');
    const info = (await this.apiWithStoredToken(token).get(`/act_${adId}`, { params: { fields: 'name' } })).data;
    await this.saveOauthAccount(userId, info.name || 'Meta', adId, pageId ?? null, token);
    return { ok: true, name: info.name };
  }

  // 5) Desconectar Meta (borra las cuentas vinculadas del usuario).
  async disconnect(userId: string) {
    await this.db.query('DELETE FROM meta_accounts WHERE user_id = $1', [userId]);
    return { ok: true };
  }

  // ── Get ad accounts for user ──────────────────────────────────────────────

  async getAccounts(userId: string) {
    const { rows } = await this.db.query(
      `SELECT id, name, meta_ad_account_id, meta_business_id,
              meta_pixel_id, meta_page_id, whatsapp_number, is_active, created_at
       FROM meta_accounts WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  }
}
