import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsUUID, ValidateIf } from 'class-validator';

export class SnoozeGoalDto {
  @ApiProperty({ description: 'UUID of the goal to snooze', format: 'uuid' })
  @IsUUID()
  goalId: string;

  @ApiProperty({
    type: String,
    description:
      'ISO-8601 date the task should come back on. Pass `null` to bring it back immediately.',
    nullable: true,
    example: '2026-09-20T00:00:00.000Z',
  })
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  snoozedUntil: string | null;
}
