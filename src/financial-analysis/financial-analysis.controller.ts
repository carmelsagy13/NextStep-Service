import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FinancialAnalysisService } from './financial-analysis.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('Financial Analysis')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('finance')
export class FinancialAnalysisController {
  constructor(private readonly financialAnalysisService: FinancialAnalysisService) {}

  @Get('snapshot')
  @ApiOperation({ summary: 'Get computed financial snapshot' })
  getSnapshot(@CurrentUser() user: { userId: string }) {
    return this.financialAnalysisService.getSnapshot(user.userId);
  }
}
