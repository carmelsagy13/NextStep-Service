import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { NotificationsService } from './notifications.service.js';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all user notifications' })
  getNotifications() {
    // TODO: extract userId from JWT
    return this.notificationsService.getNotifications('placeholder-user-id');
  }

  @Post('readNotifications')
  @ApiOperation({ summary: 'Mark notifications as read' })
  markAsRead(@Body() body: { notificationIds: string[] }) {
    return this.notificationsService.markAsRead(body.notificationIds);
  }
}
