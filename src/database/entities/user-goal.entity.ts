import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity.js';
import { RoadmapGoal } from './roadmap-goal.entity.js';
import { UserAspiration } from './user-aspiration.entity.js';

/**
 * Lifecycle status of a user task. Replaces the previous boolean `isCompleted`
 * flag with an explicit state machine so reassessments can transition tasks
 * without destroying their identity or history.
 *
 *   ACTIVE     → task is currently assigned to the user.
 *   COMPLETED  → user finished the task (terminal, retained in history).
 *   REMOVED    → reconciliation decided the task is no longer relevant
 *                (soft-deleted; can be REACTIVATED to ACTIVE — never duplicated).
 *   ABANDONED  → user explicitly dismissed the task.
 *   EXPIRED    → task passed its target date without completion.
 */
export enum UserGoalStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  REMOVED = 'removed',
  ABANDONED = 'abandoned',
  EXPIRED = 'expired',
}

/**
 * Why the user marked a task as not relevant for them. Captured when a task is
 * dismissed so future task selection can avoid goals with the same mismatch.
 */
export enum GoalDismissalReason {
  ALREADY_DONE = 'already_done',
  NO_BUDGET = 'no_budget',
  NO_TIME = 'no_time',
  RISK_MISMATCH = 'risk_mismatch',
  TOO_COMPLEX = 'too_complex',
  NOT_RELEVANT = 'not_relevant',
  OTHER = 'other',
}

@Entity('user_goals')
export class UserGoal {
  @PrimaryGeneratedColumn('uuid', { name: 'goal_id' })
  goalId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'roadmap_goal_id', nullable: true })
  roadmapGoalId: string;

  /**
   * The overarching {@link UserAspiration} this task serves (e.g. the wedding
   * goal a monthly-saving task contributes to). NULL for tasks not tied to a
   * user-declared aspiration. Lets reconciliation re-tune this task when the
   * aspiration's target amount/date changes.
   */
  @Column({ type: 'uuid', name: 'aspiration_id', nullable: true })
  aspirationId: string | null;

  /**
   * The aspiration `revision` this task was last reconciled against. When it
   * trails the aspiration's current revision the task is stale and the LLM
   * should update its parameters.
   */
  @Column({ type: 'int', name: 'synced_aspiration_revision', nullable: true })
  syncedAspirationRevision: number | null;

  @Column({ type: 'varchar', length: 100, name: 'goal_name' })
  goalName: string;

  @Column({ type: 'jsonb', name: 'dynamic_params', nullable: true })
  dynamicParams: Record<string, any>;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'target_amount',
    nullable: true,
  })
  targetAmount: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    name: 'current_amount',
    default: 0,
  })
  currentAmount: number;

  @Column({ type: 'date', name: 'target_date', nullable: true })
  targetDate: Date;

  // ── Lifecycle state machine (replaces the old is_completed boolean) ───────
  @Column({
    type: 'enum',
    enum: UserGoalStatus,
    default: UserGoalStatus.ACTIVE,
  })
  status: UserGoalStatus;

  /** Relative ordering within the user's active task list (lower = higher priority). */
  @Column({ type: 'int', default: 0 })
  priority: number;

  @CreateDateColumn({ type: 'timestamp', name: 'assigned_at' })
  assignedAt: Date;

  /**
   * The roadmap step the user stood on when this task was assigned. NULL for
   * rows created before step attribution existed, and whenever the user has no
   * current step yet (no analysis run).
   */
  @Column({ type: 'int', name: 'assigned_at_step', nullable: true })
  assignedAtStep: number | null;

  @Column({ type: 'timestamp', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  /**
   * The roadmap step the user stood on when this task was completed. Lets the
   * client show a step's history without inferring it from the roadmap
   * template, whose step_id is the eligibility threshold — not where the user
   * actually was. Cleared alongside `completedAt` when a task is un-completed.
   */
  @Column({ type: 'int', name: 'completed_at_step', nullable: true })
  completedAtStep: number | null;

  @Column({ type: 'timestamp', name: 'removed_at', nullable: true })
  removedAt: Date | null;

  /** LLM/user justification recorded when a task transitions to REMOVED. */
  @Column({ type: 'text', name: 'removal_reason', nullable: true })
  removalReason: string | null;

  // ── User "not relevant" feedback ─────────────────────────────────────────
  // Deliberately separate from `removalReason`, which the reconciliation LLM
  // writes: mixing machine decisions with user feedback corrupts the signal.
  // These survive a later LLM reactivation of the task — they are history.
  @Column({
    type: 'enum',
    enum: GoalDismissalReason,
    name: 'dismissal_reason',
    nullable: true,
  })
  dismissalReason: GoalDismissalReason | null;

  /** Free-text elaboration, only captured for {@link GoalDismissalReason.OTHER}. */
  @Column({ type: 'text', name: 'dismissal_note', nullable: true })
  dismissalNote: string | null;

  @Column({ type: 'timestamp', name: 'dismissed_at', nullable: true })
  dismissedAt: Date | null;

  /**
   * Provenance: the UserProfileHistory assessment that last created, reactivated
   * or reprioritized this task. Plain UUID reference (no FK constraint) to keep
   * history immutable and decoupled from task rows.
   */
  @Column({ type: 'uuid', name: 'source_profile_history_id', nullable: true })
  sourceProfileHistoryId: string | null;

  @Column({ type: 'text', name: 'ai_insight', nullable: true })
  aiInsight: string;

  @ManyToOne(() => User, (user) => user.goals, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => RoadmapGoal, (roadmapGoal) => roadmapGoal.userGoals, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'roadmap_goal_id' })
  roadmapGoal: RoadmapGoal;

  @ManyToOne(() => UserAspiration, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'aspiration_id' })
  aspiration: UserAspiration | null;
}
