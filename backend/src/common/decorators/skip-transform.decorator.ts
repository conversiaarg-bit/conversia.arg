import { SetMetadata } from '@nestjs/common';

// Marca un endpoint para que el TransformInterceptor NO envuelva su respuesta
// en { success, data, timestamp }. Necesario cuando un tercero (ej. el webhook
// de verificación de Meta) espera el body crudo (texto plano).
export const SKIP_TRANSFORM = 'skipTransform';
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM, true);
