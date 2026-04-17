import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { UserNotification } from '../database/entities/user-notification.entity.js';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(UserNotification)
    private readonly notificationRepo: Repository<UserNotification>,
  ) {}

  async getNotifications(userId: string) {
    return this.notificationRepo.find({
      where: { userId },
      order: { sentAt: 'DESC' },
      relations: ['template'],
    });
  }

  async markAsRead(notificationIds: string[]) {
    await this.notificationRepo.update(
      { notificationId: In(notificationIds) },
      { isRead: true },
    );
    return { message: 'Notifications marked as read' };
  }
}
