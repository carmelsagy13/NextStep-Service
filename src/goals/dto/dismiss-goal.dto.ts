import {
  IsUUID,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GoalDismissalReason } from '../../database/entities/user-goal.entity.js';

export class DismissGoalDto {
  @ApiProperty({ description: 'UUID of the goal to dismiss', format: 'uuid' })
  @IsUUID()
  goalId: string;

  @ApiProperty({
    description: 'Why the task is not relevant for this user',
    enum: GoalDismissalReason,
  })
  @IsEnum(GoalDismissalReason)
  reason: GoalDismissalReason;

  @ApiPropertyOptional({
    description: 'Free-text elaboration. Only stored when reason is `other`.',
    maxLength: 280,
  })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}
