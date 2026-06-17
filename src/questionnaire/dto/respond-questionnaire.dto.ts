import {
  IsArray,
  IsDefined,
  IsNotEmpty,
  IsString,
  ValidateNested,
  ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * A single answer in a questionnaire submission.
 *
 * The DTO performs only STRUCTURAL validation (key present, value supplied).
 * Semantic validation — whether `value`'s shape matches the question's type,
 * is a valid option, satisfies numeric/text constraints, and whether the
 * question is currently visible — is performed in the service against the live
 * DB-defined schema, because those rules are data, not code.
 */
export class AnswerItemDto {
  @ApiProperty({
    description: 'Stable key of the answered question (e.g. q_family_status).',
    example: 'q_family_status',
  })
  @IsString()
  @IsNotEmpty()
  questionKey: string;

  @ApiProperty({
    description:
      'The answer value. Shape depends on the question type: a string for ' +
      'SINGLE_CHOICE/TEXT, a number for NUMBER, or a string[] for MULTIPLE_CHOICE.',
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'array', items: { type: 'string' } },
    ],
    example: 'in_relationship_married',
  })
  @IsDefined()
  value: string | number | string[];
}

export class RespondQuestionnaireDto {
  @ApiProperty({
    description: 'Flat list of the user\'s answers, one entry per question.',
    type: [AnswerItemDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AnswerItemDto)
  answers: AnswerItemDto[];
}
