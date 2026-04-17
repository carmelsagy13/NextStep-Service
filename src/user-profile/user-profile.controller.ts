import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UserProfileService } from './user-profile.service.js';

@ApiTags('User Profile')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('profile')
export class UserProfileController {
  constructor(private readonly userProfileService: UserProfileService) {}

  @Post('notificationPreferences')
  @ApiOperation({ summary: 'Save notification preferences' })
  saveNotificationPreferences(@Body() body: any) {
    // TODO: implement DTO and logic
    return this.userProfileService.saveNotificationPreferences(body);
  }
}
