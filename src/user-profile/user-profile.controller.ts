import { Controller, Get, UseGuards, Header } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UserProfileService } from './user-profile.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('User Profile')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('profile')
export class UserProfileController {
  constructor(private readonly userProfileService: UserProfileService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Get current user profile. Returns 404 if no profile exists (e.g. after deletion).',
  })
  getProfile(@CurrentUser() user: { userId: string }) {
    return this.userProfileService.getProfile(user.userId);
  }

  @Get('history')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Get the user\u2019s assessment history (abstracted level/criteria snapshots over time).',
  })
  getHistory(@CurrentUser() user: { userId: string }) {
    return this.userProfileService.getHistory(user.userId);
  }

  @Get('progress')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Get current pyramid level and progress delta vs the previous assessment.',
  })
  getProgress(@CurrentUser() user: { userId: string }) {
    return this.userProfileService.getProgress(user.userId);
  }
}
