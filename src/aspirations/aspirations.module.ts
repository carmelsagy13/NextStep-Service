import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AspirationsController } from './aspirations.controller.js';
import { AspirationsService } from './aspirations.service.js';
import { AspirationSyncService } from './aspiration-sync.service.js';
import { UserAspiration } from '../database/entities/user-aspiration.entity.js';
import { GoalTypeCatalog } from '../database/entities/goal-type-catalog.entity.js';
import { UserGoal } from '../database/entities/user-goal.entity.js';
import { RoadmapGoal } from '../database/entities/roadmap-goal.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';

/**
 * Owns the overarching user goals ("aspirations") store: the goal-type catalog,
 * per-user aspiration CRUD, and the focused LLM re-sync that re-tunes linked
 * roadmap tasks when an aspiration changes. Exports {@link AspirationsService}
 * so the questionnaire can route onboarding goal answers here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserAspiration,
      GoalTypeCatalog,
      UserGoal,
      RoadmapGoal,
      UserProfile,
    ]),
  ],
  controllers: [AspirationsController],
  providers: [AspirationsService, AspirationSyncService],
  exports: [AspirationsService, AspirationSyncService],
})
export class AspirationsModule {}
