import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { UserNotification } from '../database/entities/user-notification.entity.js';
import { NotificationTemplate } from '../database/entities/notification-template.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([UserNotification, NotificationTemplate])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
