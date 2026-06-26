import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity.js';
import { GoalTypeCatalog } from './goal-type-catalog.entity.js';

/**
 * Lifecycle of an overarching goal the user is striving for.
 *
 *   ACTIVE    → the user is currently pursuing this goal.
 *   ACHIEVED  → the goal was reached (terminal, kept for history).
 *   ABANDONED → the user dropped the goal (e.g. deselected it in onboarding).
 */
export enum UserAspirationStatus {
  ACTIVE = 'active',
  ACHIEVED = 'achieved',
  ABANDONED = 'abandoned',
}

/**
 * A user's OVERARCHING financial goal (an "aspiration") — e.g. saving for a
 * wedding, a big trip, a car, home equity. This is the dedicated, scalable home
 * for goals that previously lived as `q_financial_goals` answers inside
 * `questionnaire_responses`.
 *
 * Distinct from {@link UserGoal} (an actionable, roadmap-driven TASK): an
 * aspiration is the long-term "what I want", while one or more UserGoals are the
 * concrete "how I get there". UserGoals link back here via `aspiration_id` so
 * the LLM can re-tune those tasks when the aspiration changes.
 *
 * Dynamic, goal-type-specific fields (milestones, custom targets, …) live in the
 * free-form {@link attributes} JSONB, validated against the goal type's
 * {@link GoalTypeCatalog.attributeSchema} — so new fields need no migration.
 */
@Entity('user_aspirations')
@Unique('uq_user_aspiration_type', ['userId', 'goalTypeCode'])
export class UserAspiration {
  @PrimaryGeneratedColumn('uuid', { name: 'aspiration_id' })
  aspirationId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** Goal type code, FK to {@link GoalTypeCatalog.code} (e.g. `wedding_event`). */
  @Column({ type: 'varchar', length: 100, name: 'goal_type_code' })
  goalTypeCode: string;

  /** Snapshot of the goal type's Hebrew label at creation time, for display. */
  @Column({ type: 'varchar', length: 255, name: 'title' })
  title: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'target_amount',
    nullable: true,
  })
  targetAmount: number | null;

  @Column({ type: 'date', name: 'target_date', nullable: true })
  targetDate: Date | null;

  /**
   * Dynamic, goal-type-specific attributes (e.g. `{ timeframeMonths: 24,
   * milestones: [...] }`). Validated against the catalog's attributeSchema.
   */
  @Column({ type: 'jsonb', name: 'attributes', nullable: true })
  attributes: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: UserAspirationStatus,
    default: UserAspirationStatus.ACTIVE,
  })
  status: UserAspirationStatus;

  /**
   * Monotonically increasing version, bumped on every MATERIAL change (target
   * amount / date / attributes). The reconciliation pipeline compares this to
   * {@link lastSyncedRevision} to detect aspirations whose linked tasks still
   * need re-tuning by the LLM.
   */
  @Column({ type: 'int', name: 'revision', default: 1 })
  revision: number;

  /** The `revision` value the LLM last reconciled the linked tasks against. */
  @Column({ type: 'int', name: 'last_synced_revision', nullable: true })
  lastSyncedRevision: number | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => GoalTypeCatalog, (type) => type.aspirations, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'goal_type_code', referencedColumnName: 'code' })
  goalType: GoalTypeCatalog;
}
