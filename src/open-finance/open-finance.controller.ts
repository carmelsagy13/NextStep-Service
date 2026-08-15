import {
  Controller, Post, Get, Delete, Body, Query,
  UseGuards, UseInterceptors, UploadedFile,
  BadRequestException, HttpCode, HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { OpenFinanceService } from './open-finance.service.js';
import { OpenFinanceApiService } from './open-finance-api.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('Open Finance')
@Controller('openfinance')
export class OpenFinanceController {
  constructor(
    private readonly openFinanceService: OpenFinanceService,
    private readonly openFinanceApiService: OpenFinanceApiService,
  ) {}

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

  /**
   * POST /openfinance/upload
   * Accepts a multipart/form-data upload with a single JSON file (field: 'file').
   * Returns the user's financial stage as classified by Gemini.
   */
  @Post('upload')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Upload Open Banking JSON and classify financial stage via Gemini' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.endsWith('.json') && file.mimetype !== 'application/json') {
          return cb(new BadRequestException('Only JSON files are accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  uploadAndAnalyze(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { userId: string },
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded — use field name \'file\'');
    }
    return this.openFinanceService.analyzeFile(file.buffer, user.userId);
  }

  /**
   * POST /openfinance/connect-api
   * Parallel path to /upload: pulls financial data from the Open Finance provider
   * (auth → connection → job → poll), then runs the result through the same
   * LLM-based normalization + persistence pipeline used by the upload flow.
   */
  @Post('connect-api')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Fetch financial data via the Open Finance API and persist it through the existing analysis pipeline',
  })
  connectApi(@CurrentUser() user: { userId: string }) {
    return this.openFinanceApiService.connectAndAnalyze(user.userId);
  }

  /**
   * DELETE /openfinance/reset-account
   * Wipes all financial profile and roadmap data for the authenticated user.
   * The user account itself is preserved.
   */
  @Delete('reset-account')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Reset all financial data for the authenticated user (goals, profile, roadmap state)' })
  resetAccount(@CurrentUser() user: { userId: string }) {
    return this.openFinanceService.resetUserData(user.userId);
  }
}
