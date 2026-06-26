import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsDateString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Create a new overarching goal (aspiration) for the current user. The
 * `goalTypeCode` must reference an active row in `goal_type_catalog`; the
 * `attributes` blob is validated against that goal type's attribute schema.
 */
export class CreateAspirationDto {
  @ApiProperty({ description: 'Goal type code from goal_type_catalog (e.g. wedding_event)' })
  @IsString()
  goalTypeCode: string;

  @ApiPropertyOptional({ description: 'Monetary target for the goal (NIS)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetAmount?: number;

  @ApiPropertyOptional({ description: 'Target date (ISO-8601, e.g. 2027-06-01)' })
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @ApiPropertyOptional({
    description: 'Dynamic, goal-type-specific attributes (validated against the catalog schema)',
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}
