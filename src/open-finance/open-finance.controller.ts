import {
  Controller, Post, Get, Body, Query,
  UseGuards, UseInterceptors, UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
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

  /**
   * POST /openfinance/upload
   * Accepts a multipart/form-data upload with a single JSON file (field: 'file').
   * Returns the user's financial stage as classified by Gemini.
   */
  @Post('upload')
  @ApiBearerAuth()
  //@UseGuards(AuthGuard('jwt'))
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
  uploadAndAnalyze(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded — use field name \'file\'');
    }
    return this.openFinanceService.analyzeFile(file.buffer);
  }
}
