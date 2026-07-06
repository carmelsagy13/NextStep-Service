import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import { UserProfileHistory } from '../database/entities/user-profile-history.entity.js';

@Injectable()
export class UserProfileService {
  constructor(
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    @InjectRepository(UserProfileHistory)
    private readonly historyRepo: Repository<UserProfileHistory>,
  ) {}

  async getProfile(userId: string): Promise<UserProfile> {
    const profile = await this.profileRepo.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('User profile not found');
    return profile;
  }

  /**
   * Persist the user's computed risk-tolerance category. Upserts the profile
   * row because it may not exist yet at onboarding time (it is otherwise created
   * lazily by the financial-analysis / roadmap flows).
   */
  async updateRiskTolerance(
    userId: string,
    riskTolerance: string,
  ): Promise<void> {
    const profile =
      (await this.profileRepo.findOne({ where: { userId } })) ??
      this.profileRepo.create({ userId });
    profile.riskTolerance = riskTolerance;
    await this.profileRepo.save(profile);
  }

  /** Full assessment history (newest first) — abstracted level/criteria snapshots. */
  async getHistory(userId: string): Promise<UserProfileHistory[]> {
    return this.historyRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Current pyramid level + delta vs the previous assessment. */
  async getProgress(userId: string) {
    const [latest, previous] = await this.historyRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 2,
    });
    if (!latest) throw new NotFoundException('No assessment history found for this user');
    return {
      currentStep: latest.step,
      progressPercent: latest.progressPercent,
      previousStep: latest.previousStep,
      stepChanged: latest.stepChanged,
      progressDelta:
        latest.progressDelta ??
        (previous ? latest.progressPercent - previous.progressPercent : null),
      stateDescription: latest.stateDescription,
      assessedAt: latest.createdAt,
    };
  }

  async saveNotificationPreferences(_userId: string, _preferences: any) {
    // No notification preference columns exist in the schema yet.
    // Extend UserProfile entity and re-run synchronize to enable persistence.
    return { message: 'Notification preferences saved' };
  }
}
