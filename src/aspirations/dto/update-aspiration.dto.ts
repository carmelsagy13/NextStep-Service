import {
  IsOptional,
  IsNumber,
  IsObject,
  IsDateString,
  IsEnum,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserAspirationStatus } from '../../database/entities/user-aspiration.entity.js';

/**
 * Partial update of an existing aspiration. Any material change (targetAmount,
 * targetDate, attributes) bumps the aspiration's `revision` and triggers an
 * immediate LLM re-sync of the linked roadmap tasks.
 */
export class UpdateAspirationDto {
  @ApiPropertyOptional({ description: 'Monetary target for the goal (NIS)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetAmount?: number;

  @ApiPropertyOptional({ description: 'Target date (ISO-8601)' })
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @ApiPropertyOptional({
    description:
      'Dynamic, goal-type-specific attributes (validated against the catalog schema)',
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Lifecycle status',
    enum: UserAspirationStatus,
  })
  @IsOptional()
  @IsEnum(UserAspirationStatus)
  status?: UserAspirationStatus;
}
