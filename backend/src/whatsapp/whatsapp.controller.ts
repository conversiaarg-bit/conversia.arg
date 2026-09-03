import {
  Controller, Get, Post, Patch, Body, Param,
  Query, UseGuards, Request, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';
import { WhatsappService } from './whatsapp.service';

@ApiTags('whatsapp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('webhook')
  @SkipTransform()
  @ApiExcludeEndpoint()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.whatsappService.verifyWebhook(mode, token, challenge);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  handleWebhook(@Body() body: any) {
    return this.whatsappService.handleWebhook(body);
  }

  @Get('leads')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Listar leads de WhatsApp' })
  getLeads(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.whatsappService.getLeads(req.user.id, { status, page: +page, limit: +limit });
  }

  @Patch('leads/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Actualizar estado de un lead' })
  updateLead(
    @Param('id') id: string,
    @Request() req: any,
    @Body('status') status: string,
    @Body('notes') notes?: string,
  ) {
    return this.whatsappService.updateLeadStatus(id, req.user.id, status, notes);
  }

  @Get('metrics')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Métricas de leads de WhatsApp' })
  getMetrics(@Request() req: any) {
    return this.whatsappService.getLeadMetrics(req.user.id);
  }
}
