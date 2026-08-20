import {
  Controller,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { DemoService, DemoTriggerResult } from './demo.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('Demo')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('demo')
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  /**
   * POST /demo/trigger
   *
   * Runs the lightweight PARTIAL sync for the authenticated user — this is the
   * SESSION REFRESH path. It re-tunes roadmap tasks linked to stale aspirations
   * without re-running the expensive full LLM classification (that already ran
   * at login).
   *
   * Only accessible when the server is started with DEMO_MODE=true.
   * Returns 403 Forbidden otherwise.
   */
  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Demo Mode session-refresh: lightweight partial task re-sync',
    description:
      'Runs the lightweight aspiration sync (session refresh). The full pipeline ' +
      'runs automatically at login. Requires DEMO_MODE=true on the server.',
  })
  @ApiResponse({
    status: 200,
    description: 'Partial sync completed. `mode` is always "partial".',
  })
  @ApiResponse({
    status: 403,
    description: 'Demo mode is not enabled on this server.',
  })
  trigger(@CurrentUser() user: { userId: string }): Promise<DemoTriggerResult> {
    return this.demoService.runPartial(user.userId);
  }
}
