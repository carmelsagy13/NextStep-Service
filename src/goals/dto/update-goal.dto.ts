import { IsUUID, IsNumber, IsBoolean, IsOptional, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({ description: 'Whether the goal is completed' })
  @IsOptional()
  @Transform(({ value }) => (value !== undefined && value !== null ? Boolean(value) : value))
  @IsBoolean()
  isCompleted?: boolean;
}
