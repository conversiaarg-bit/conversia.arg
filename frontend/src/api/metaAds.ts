import api from './client';

export interface MetaAsset { id: string; name: string; account_status?: number }

export const metaAdsApi = {
  // Cuentas ya conectadas (para saber si Meta está vinculado)
  getAccounts: () => api.get('/meta-ads/accounts'),

  // URL del login de Facebook para conectar (OAuth dentro de Conversia)
  oauthUrl: () => api.get<{ url: string }>('/meta-ads/oauth/url'),

  // Cuentas publicitarias + páginas disponibles del token conectado
  assets: () => api.get<{ adAccounts: MetaAsset[]; pages: MetaAsset[] }>('/meta-ads/assets'),

  // Elegir cuenta publicitaria + página
  select: (adAccountId: string, pageId?: string) => api.post('/meta-ads/select', { adAccountId, pageId }),

  // Desconectar Meta
  disconnect: () => api.delete('/meta-ads/accounts'),
};
