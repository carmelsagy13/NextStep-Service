import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuestionnaireController } from './questionnaire.controller.js';
import { QuestionnaireService } from './questionnaire.service.js';
import { QuestionnaireScreen } from '../database/entities/questionnaire-screen.entity.js';
import { QuestionnaireQuestion } from '../database/entities/questionnaire-question.entity.js';
import { QuestionnaireOption } from '../database/entities/questionnaire-option.entity.js';
import { QuestionnaireDependency } from '../database/entities/questionnaire-dependency.entity.js';
import { QuestionnaireSubmission } from '../database/entities/questionnaire-submission.entity.js';
import { QuestionnaireResponse } from '../database/entities/questionnaire-response.entity.js';
import { AspirationsModule } from '../aspirations/aspirations.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      QuestionnaireScreen,
      QuestionnaireQuestion,
      QuestionnaireOption,
      QuestionnaireDependency,
      QuestionnaireSubmission,
      QuestionnaireResponse,
    ]),
    AspirationsModule,
  ],
  controllers: [QuestionnaireController],
  providers: [QuestionnaireService],
  exports: [QuestionnaireService],
})
export class QuestionnaireModule {}
