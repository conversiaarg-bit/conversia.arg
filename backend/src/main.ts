import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { autoMigrate } from './database/auto-migrate';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { createWinstonLogger } from './common/logger/winston.config';

async function bootstrap() {
  await autoMigrate();

  const uploadsDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Required for Stripe webhook signature validation
    rawBody: true,
    // Winston replaces the default NestJS logger
    logger: WinstonModule.createLogger(createWinstonLogger('bootstrap')),
  });

  // Subimos el límite de body: los comprobantes y fotos van como base64 (pueden pesar varios MB)
  app.useBodyParser('json', { limit: '25mb' });
  app.useBodyParser('urlencoded', { limit: '25mb', extended: true });

  const config = app.get(ConfigService);
  const port = config.get<number>('port', 3000);
  const env = config.get<string>('nodeEnv', 'development');

  // ── Static files (uploaded media) — CORS abierto para poder descargarlos ──
  app.useStaticAssets(uploadsDir, {
    prefix: '/uploads',
    setHeaders: (res: any) => res.set('Access-Control-Allow-Origin', '*'),
  });

  // ── Security ──────────────────────────────────────────────────────────────
  app.use(helmet());
  app.enableCors({
    origin: config.get<string>('frontendUrl', 'http://localhost:3001'),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ── Global prefix (exclude /health from prefix) ───────────────────────────
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });

  // ── Pipes ─────────────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Filters & Interceptors ────────────────────────────────────────────────
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));

  // ── Swagger (non-production only) ──────────────────────────────────────────
  if (env !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AI Commerce Ads Suite API')
      .setDescription('API para la plataforma SaaS de automatización de Meta Ads')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Autenticación y sesiones')
      .addTag('users', 'Gestión de usuarios')
      .addTag('campaigns', 'Campañas publicitarias')
      .addTag('creatives', 'Creativos generados por IA')
      .addTag('meta-ads', 'Integración Meta Ads API')
      .addTag('payments', 'Pagos y suscripciones Stripe')
      .addTag('reports', 'Informes automáticos')
      .addTag('ai', 'Servicios de inteligencia artificial')
      .addTag('admin', 'Panel de administración')
      .addTag('health', 'Estado del sistema')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    console.log(`📚 Swagger docs → http://localhost:${port}/api/docs`);
  }

  await app.listen(port);
  console.log(`🚀 API running on port ${port} [${env}]`);
}

bootstrap();
