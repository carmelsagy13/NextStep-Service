import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoadmapGoalType } from '../../database/entities/roadmap-goal.entity.js';
import { UserGoalStatus } from '../../database/entities/user-goal.entity.js';

/**
 * Everything the client needs to render a sponsored goal. Present only when the
 * backing offer is live and passes serialization validation; otherwise the goal
 * degrades to a plain one and this block is null.
 */
export class MarketingMetaDto {
  @ApiProperty({
    description: 'Stable offer key, the handle for future click attribution.',
  })
  offerCode: string;

  @ApiProperty({ description: 'Partner display name in Hebrew.' })
  partnerName: string;

  @ApiProperty({ description: 'Absolute URL of the partner logo.' })
  partnerLogoUrl: string;

  @ApiPropertyOptional({
    description: 'Absolute URL of an optional wide banner.',
  })
  bannerUrl: string | null;

  @ApiPropertyOptional({ description: 'Hex accent colour for card styling.' })
  brandColor: string | null;

  @ApiProperty({ description: 'Exclusive-deal headline.' })
  headline: string;

  @ApiPropertyOptional()
  subheadline: string | null;

  @ApiProperty({ type: [String], description: 'Short promotional chips.' })
  benefitTags: string[];

  @ApiProperty({ description: 'CTA button text.' })
  ctaLabel: string;

  @ApiProperty({ description: 'External partner link. Always https.' })
  ctaUrl: string;

  @ApiProperty({ description: 'Mandatory regulatory disclosure text.' })
  disclaimer: string;
}

/** The goal shape returned to the client. */
export class GoalResponseDto {
  @ApiProperty() goalId: string;
  @ApiProperty() userId: string;
  @ApiProperty({ nullable: true }) roadmapGoalId: string | null;
  @ApiProperty({ nullable: true }) aspirationId: string | null;
  @ApiProperty() goalName: string;
  @ApiProperty({ nullable: true }) targetAmount: number | null;
  @ApiProperty() currentAmount: number;
  @ApiProperty({ nullable: true }) targetDate: string | null;
  @ApiProperty({ enum: UserGoalStatus }) status: UserGoalStatus;
  @ApiProperty() priority: number;
  @ApiProperty({ nullable: true }) assignedAt: Date | null;
  @ApiProperty({ nullable: true }) assignedAtStep: number | null;
  @ApiProperty({ nullable: true }) completedAt: Date | null;
  @ApiProperty({ nullable: true }) completedAtStep: number | null;
  @ApiProperty({ nullable: true }) removedAt: Date | null;
  @ApiProperty({ nullable: true }) removalReason: string | null;
  @ApiProperty({ nullable: true }) sourceProfileHistoryId: string | null;
  @ApiProperty({ nullable: true }) aiInsight: string | null;
  @ApiProperty({ type: Object, nullable: true }) dynamicParams: Record<
    string,
    unknown
  > | null;

  @ApiProperty({
    enum: RoadmapGoalType,
    description:
      "Presentation category. Reported as `personal` when a marketing goal's offer is no longer live.",
  })
  goalType: RoadmapGoalType;

  @ApiPropertyOptional({ type: MarketingMetaDto, nullable: true })
  marketing: MarketingMetaDto | null;

  @ApiPropertyOptional({
    description:
      'The originating roadmap template, when the goal came from one.',
  })
  roadmapGoal?: {
    goalId: string;
    stepId: number;
    criteria: string | null;
    type: RoadmapGoalType;
    title: string;
    descriptionTemplate: string;
    dynamicParams: Record<string, unknown> | null;
    requiredContext: string | null;
    isActive: boolean;
    priority: number;
  };
}
