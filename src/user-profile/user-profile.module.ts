import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserProfileService } from './user-profile.service.js';
import { UserProfileController } from './user-profile.controller.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import { UserProfileHistory } from '../database/entities/user-profile-history.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([UserProfile, UserProfileHistory])],
  controllers: [UserProfileController],
  providers: [UserProfileService],
  exports: [UserProfileService],
})
export class UserProfileModule {}
