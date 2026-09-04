import { Controller, Post, Get, Delete, Body, Query, Res, UseGuards, Request } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';
import { MetaAdsService } from './meta-ads.service';
import { ConnectMetaAccountDto } from './dto/connect-meta-account.dto';

@ApiTags('meta-ads')
@Controller('meta-ads')
export class MetaAdsController {
  constructor(private readonly metaAdsService: MetaAdsService) {}

  // ── OAuth (conectar Meta desde adentro de Conversia) ──────────────────────

  @Get('oauth/url')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'URL del login de Facebook para conectar Meta' })
  oauthUrl(@Request() req: any) {
    return this.metaAdsService.oauthUrl(req.user.id);
  }

  // Meta redirige el navegador acá (sin nuestro JWT) → identidad vía `state` firmado.
  @Get('oauth/callback')
  @SkipTransform()
  @ApiExcludeEndpoint()
  async oauthCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const url = await this.metaAdsService.oauthCallback(code, state);
    return res.redirect(url);
  }

  @Get('assets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cuentas publicitarias y páginas disponibles' })
  assets(@Request() req: any) {
    return this.metaAdsService.listAssets(req.user.id);
  }

  @Post('select')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Elegir cuenta publicitaria + página' })
  select(@Request() req: any, @Body() body: { adAccountId: string; pageId?: string }) {
    return this.metaAdsService.selectAccount(req.user.id, body.adAccountId, body.pageId);
  }

  // ── Conexión manual (token pegado a mano) — se mantiene como alternativa ───

  @Post('connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Conectar cuenta de Meta Ads (manual)' })
  connect(@Request() req: any, @Body() dto: ConnectMetaAccountDto) {
    return this.metaAdsService.connectAccount(req.user.id, dto);
  }

  @Get('accounts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar cuentas de Meta Ads conectadas' })
  getAccounts(@Request() req: any) {
    return this.metaAdsService.getAccounts(req.user.id);
  }

  @Delete('accounts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desconectar Meta' })
  disconnect(@Request() req: any) {
    return this.metaAdsService.disconnect(req.user.id);
  }
}
