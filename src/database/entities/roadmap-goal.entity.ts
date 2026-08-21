import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { GoalEffortLevel } from './goal-effort-level.enum.js';
import { UserGoal } from './user-goal.entity.js';
import { PartnerOffer } from './partner-offer.entity.js';

export enum RoadmapGoalType {
  PERSONAL = 'personal',
  MARKETING = 'marketing',
  BONUS = 'bonus',
  EDUCATIONAL = 'educational',
}

/**
 * The 8 granular financial criteria a goal can be scoped to. A goal tagged with
 * one of these is a "criteria goal": it becomes eligible based on the user's
 * per-criteria step (e.g. their `loans` score) rather than their overall step.
 * A NULL `criteria` marks a general goal, matched by the overall current step.
 */
export const ROADMAP_GOAL_CRITERIA = [
  'cash_flow',
  'credit_consumption',
  'loans',
  'savings_investments',
  'pension_long_term',
  'lifestyle_clubs',
  'mortgage',
  'system_indicators',
] as const;

export type RoadmapGoalCriteria = (typeof ROADMAP_GOAL_CRITERIA)[number];

@Entity('roadmap_goals')
export class RoadmapGoal {
  @PrimaryGeneratedColumn('uuid', { name: 'goal_id' })
  goalId: string;

  @Column({ type: 'int', name: 'step_id' })
  stepId: number;

  /**
   * Optional criteria this goal is scoped to. When set, the goal is eligible
   * once the user reaches `step_id` in that criteria (profile[criteria] >=
   * step_id), independently of their overall current step. NULL = general goal.
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  criteria: RoadmapGoalCriteria | null;

  @Column({ type: 'enum', enum: RoadmapGoalType })
  type: RoadmapGoalType;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', name: 'description_template' })
  descriptionTemplate: string;

  @Column({ type: 'jsonb', name: 'dynamic_params', nullable: true })
  dynamicParams: Record<string, any>;

  @Column({ type: 'text', name: 'required_context', nullable: true })
  requiredContext: string;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'int' })
  priority: number;

  @Column({ type: 'text', name: 'required_context_text', nullable: true })
  requiredContextText: string;

  /** Authored default effort for this template; a user task may override it. */
  @Column({
    type: 'enum',
    enum: GoalEffortLevel,
    name: 'effort_level',
    nullable: true,
  })
  effortLevel: GoalEffortLevel | null;

  /**
   * The sponsored campaign this goal promotes. Set if and only if
   * `type = MARKETING` (enforced by a DB CHECK constraint). Branding and
   * commercial terms are never duplicated here — this goal stays pure copy.
   */
  @Column({ type: 'uuid', name: 'offer_id', nullable: true })
  offerId: string | null;

  @ManyToOne(() => PartnerOffer, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'offer_id' })
  offer: PartnerOffer | null;

  @OneToMany(() => UserGoal, (userGoal) => userGoal.roadmapGoal)
  userGoals: UserGoal[];
}
