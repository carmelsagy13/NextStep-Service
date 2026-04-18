import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuestionnaireController } from './questionnaire.controller.js';
import { QuestionnaireService } from './questionnaire.service.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([UserProfile])],
  controllers: [QuestionnaireController],
  providers: [QuestionnaireService],
  exports: [QuestionnaireService],
})
export class QuestionnaireModule {}
