import { Controller, Get, Post, Body, UseGuards, Header } from '@nestjs/common';
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
  @ApiOperation({ summary: 'Get current user profile. Returns 404 if no profile exists (e.g. after deletion).' })
  getProfile(@CurrentUser() user: { userId: string }) {
    return this.userProfileService.getProfile(user.userId);
  }

  @Post('notificationPreferences')
  @ApiOperation({ summary: 'Save notification preferences' })
  saveNotificationPreferences(
    @CurrentUser() user: { userId: string },
    @Body() body: any,
  ) {
    return this.userProfileService.saveNotificationPreferences(user.userId, body);
  }
}
