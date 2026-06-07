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

@Entity('user_goals')
export class UserGoal {
  @PrimaryGeneratedColumn('uuid', { name: 'goal_id' })
  goalId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'roadmap_goal_id', nullable: true })
  roadmapGoalId: string;

  @Column({ type: 'varchar', length: 100, name: 'goal_name' })
  goalName: string;

  @Column({ type: 'jsonb', name: 'dynamic_params', nullable: true })
  dynamicParams: Record<string, any>;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'target_amount', nullable: true })
  targetAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'current_amount', default: 0 })
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

  @Column({ type: 'timestamp', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamp', name: 'removed_at', nullable: true })
  removedAt: Date | null;

  /** LLM/user justification recorded when a task transitions to REMOVED. */
  @Column({ type: 'text', name: 'removal_reason', nullable: true })
  removalReason: string | null;

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

  @ManyToOne(() => RoadmapGoal, (roadmapGoal) => roadmapGoal.userGoals, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'roadmap_goal_id' })
  roadmapGoal: RoadmapGoal;
}
