import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { QuestionnaireService } from './questionnaire.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RespondQuestionnaireDto } from './dto/respond-questionnaire.dto.js';

@ApiTags('Questionnaire')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('questionnaire')
export class QuestionnaireController {
  constructor(private readonly questionnaireService: QuestionnaireService) {}

  @Get()
  @ApiOperation({
    summary:
      'Fetch the full ordered questionnaire structure (screens, questions, ' +
      'nested sub-fields, options and conditional rules) for dynamic rendering.',
  })
  getStructure() {
    return this.questionnaireService.getStructure();
  }

  @Post('respond')
  @ApiOperation({
    summary:
      'Submit questionnaire answers. Validates types, option values, numeric/' +
      'text constraints and conditional required-ness against the live schema.',
  })
  respond(
    @CurrentUser() user: { userId: string },
    @Body() dto: RespondQuestionnaireDto,
  ) {
    return this.questionnaireService.respond(user.userId, dto);
  }
}
