import { IsUUID, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserGoalStatus } from '../../database/entities/user-goal.entity.js';

export class UpdateGoalDto {
  @ApiProperty({ description: 'UUID of the goal to update', format: 'uuid' })
  @IsUUID()
  goalId: string;

  @ApiPropertyOptional({ description: 'Current progress amount toward the target' })
  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? Number(value) : value))
  @IsNumber()
  @Min(0)
  currentAmount?: number;

  @ApiPropertyOptional({
    description: 'Lifecycle status of the goal',
    enum: UserGoalStatus,
  })
  @IsOptional()
  @IsEnum(UserGoalStatus)
  status?: UserGoalStatus;
}
