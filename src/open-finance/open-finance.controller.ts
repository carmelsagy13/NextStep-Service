import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { OpenFinanceService } from './open-finance.service.js';

@ApiTags('Open Finance')
@Controller('openfinance')
export class OpenFinanceController {
  constructor(private readonly openFinanceService: OpenFinanceService) {}

  @Post('connect')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Start Open Finance consent flow' })
  connect(@Body() body: any) {
    return this.openFinanceService.connect(body);
  }

  @Get('callback')
  @ApiOperation({ summary: 'Handle Open Finance redirect callback' })
  callback(@Query() query: any) {
    return this.openFinanceService.callback(query);
  }

  @Post('sync')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Sync latest transactions from Open Finance' })
  sync(@Body() body: any) {
    return this.openFinanceService.sync(body);
  }
}
