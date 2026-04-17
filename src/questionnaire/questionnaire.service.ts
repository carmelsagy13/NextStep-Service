import { Injectable } from '@nestjs/common';

@Injectable()
export class QuestionnaireService {
  async submit(answers: any) {
    // TODO: validate and store questionnaire answers
    return { message: 'Questionnaire submitted' };
  }
}
