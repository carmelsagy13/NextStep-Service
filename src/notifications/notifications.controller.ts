import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { NotificationsService } from './notifications.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all user notifications' })
  getNotifications(@CurrentUser() user: { userId: string }) {
    return this.notificationsService.getNotifications(user.userId);
  }

  @Post('readNotifications')
  @ApiOperation({ summary: 'Mark notifications as read' })
  markAsRead(@Body() body: { notificationIds: string[] }) {
    return this.notificationsService.markAsRead(body.notificationIds);
  }
}
