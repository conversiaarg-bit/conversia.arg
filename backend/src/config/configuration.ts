export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  frontendUrl: process.env.FRONTEND_URL ?? (process.env.NODE_ENV === 'production' ? 'https://conversia-arg.vercel.app' : 'http://localhost:3001'),

  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    name: process.env.DB_NAME ?? 'ai_commerce_ads',
    user: process.env.DB_USER ?? 'aca_user',
    password: process.env.DB_PASSWORD ?? '',
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? '',
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev_refresh_secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },

  email: {
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.EMAIL_FROM ?? 'noreply@aicommerceads.com',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    prices: {
      starter: process.env.STRIPE_PRICE_STARTER ?? '',
      growth: process.env.STRIPE_PRICE_GROWTH ?? '',
      scale: process.env.STRIPE_PRICE_SCALE ?? '',
    },
  },

  meta: {
    appId: process.env.META_APP_ID ?? '',
    appSecret: process.env.META_APP_SECRET ?? '',
    apiVersion: process.env.META_API_VERSION ?? 'v19.0',
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? '',
    loginConfigId: process.env.META_LOGIN_CONFIG_ID ?? '', // "Inicio de sesión con Facebook para empresas"
  },

  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY ?? '',
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  },

  groq: {
    apiKey: process.env.GROQ_API_KEY ?? '',
  },

  huggingface: {
    apiKey: process.env.HUGGINGFACE_API_KEY ?? '',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    chatModel: process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini', // brain: análisis/estrategia/prompts/copy
  },

  magnific: {
    apiKey: process.env.MAGNIFIC_API_KEY ?? '',
    videoModel: process.env.MAGNIFIC_VIDEO_MODEL ?? 'kling-v2', // Kling image-to-video
    videoDuration: process.env.MAGNIFIC_VIDEO_DURATION ?? '5',  // "5" | "10" seconds
  },

  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    bucketName: process.env.R2_BUCKET_NAME ?? 'aca-creatives',
    publicUrl: process.env.R2_PUBLIC_URL ?? '',
  },
});
