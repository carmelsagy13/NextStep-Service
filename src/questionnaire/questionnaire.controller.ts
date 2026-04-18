import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { QuestionnaireService } from './questionnaire.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('Questionnaire')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('questionnaire')
export class QuestionnaireController {
  constructor(private readonly questionnaireService: QuestionnaireService) {}

  @Post()
  @ApiOperation({ summary: 'Submit onboarding questionnaire answers' })
  submit(@CurrentUser() user: { userId: string }, @Body() body: any) {
    return this.questionnaireService.submit(user.userId, body);
  }
}
