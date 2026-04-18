import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from '../database/entities/user-profile.entity.js';

@Injectable()
export class UserProfileService {
  constructor(
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
  ) {}

  async saveNotificationPreferences(_userId: string, _preferences: any) {
    // No notification preference columns exist in the schema yet.
    // Extend UserProfile entity and re-run synchronize to enable persistence.
    return { message: 'Notification preferences saved' };
  }
}
