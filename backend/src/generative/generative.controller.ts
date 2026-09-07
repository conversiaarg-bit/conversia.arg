import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GenerativeService } from './generative.service';
import { AiService } from '../ai/ai.service';

@ApiTags('generative')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('generative')
export class GenerativeController {
  constructor(
    private readonly svc: GenerativeService,
    private readonly ai: AiService,
  ) {}

  @Post('image')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generar imagen hiperrealista con FLUX via HuggingFace' })
  async generateImage(@Body() body: {
    product: string;
    style?: string;
    format?: '9:16' | '4:5' | '1:1';
    hook?: string;
  }) {
    const imageBase64 = await this.svc.generateImage(
      body.product ?? 'producto',
      body.style ?? 'Producto hero',
      body.format ?? '9:16',
      body.hook,
    );
    return { imageBase64 };
  }

  @Post('openai-image')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generar imagen con OpenAI gpt-image-1 (key server-side)' })
  async generateOpenAIImage(@Body() body: {
    product: string;
    style?: string;
    format?: '9:16' | '4:5' | '1:1';
    hook?: string;
    description?: string;
    prompt?: string;
  }) {
    const imageBase64 = await this.svc.generateOpenAIImage(
      body.product ?? 'producto',
      body.style ?? 'Producto hero',
      body.format ?? '9:16',
      body.hook,
      body.description,
      body.prompt,
    );
    return { imageBase64 };
  }

  @Post('image-prompt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claude analiza foto del producto y genera prompt optimizado para OpenAI Images' })
  async buildImagePrompt(@Body() body: {
    product: string;
    style?: string;
    format?: '9:16' | '4:5' | '1:1';
    hook?: string;
    description?: string;
    imageBase64?: string;
    mimeType?: string;
  }) {
    const prompt = await this.ai.buildImagePrompt({
      product:     body.product ?? 'producto',
      style:       body.style ?? 'Producto hero',
      format:      body.format ?? '9:16',
      hook:        body.hook,
      description: body.description,
      imageBase64: body.imageBase64,
      mimeType:    body.mimeType,
    });
    return { prompt };
  }
}
