import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity.js';

/**
 * Append-only historical record of a user's *abstracted* financial profile and
 * pyramid level at each reassessment.
 *
 * Privacy note: this table intentionally stores ONLY abstracted assessment data
 * — the 8 criteria scores (1–5), the pyramid step, progress percentage and a
 * scrubbed Hebrew description. It NEVER stores raw financial figures (incomes,
 * balances, transactions). Raw banking data is processed in-memory during a
 * reconciliation run and then discarded.
 *
 * Each run inserts one row, enabling historical comparison (criteria/step/
 * progress deltas over time) without persisting the original financial data.
 */
@Entity('user_profile_history')
@Index(['userId', 'createdAt'])
export class UserProfileHistory {
  @PrimaryGeneratedColumn('uuid', { name: 'history_id' })
  historyId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  // ── Pyramid level snapshot ────────────────────────────────────────────
  @Column({ type: 'int' })
  step: number;

  @Column({ type: 'int', name: 'progress_percent', default: 0 })
  progressPercent: number;

  // ── 8 granular criteria scores (1–5 per dimension) ────────────────────
  @Column({ type: 'int', name: 'cash_flow', nullable: true })
  cashFlow: number;

  @Column({ type: 'int', name: 'credit_consumption', nullable: true })
  creditConsumption: number;

  @Column({ type: 'int', nullable: true })
  loans: number;

  @Column({ type: 'int', name: 'savings_investments', nullable: true })
  savingsInvestments: number;

  @Column({ type: 'int', name: 'pension_long_term', nullable: true })
  pensionLongTerm: number;

  @Column({ type: 'int', name: 'lifestyle_clubs', nullable: true })
  lifestyleClubs: number;

  @Column({ type: 'int', nullable: true })
  mortgage: number;

  @Column({ type: 'int', name: 'system_indicators', nullable: true })
  systemIndicators: number;

  // ── Progression metadata (vs the previous history row) ────────────────
  @Column({ type: 'int', name: 'previous_step', nullable: true })
  previousStep: number | null;

  @Column({ type: 'boolean', name: 'step_changed', default: false })
  stepChanged: boolean;

  @Column({ type: 'int', name: 'progress_delta', nullable: true })
  progressDelta: number | null;

  /** Abstracted Hebrew description of the state — scrubbed of raw amounts. */
  @Column({ type: 'text', name: 'state_description', nullable: true })
  stateDescription: string | null;

  /** LLM reasoning behind this assessment / level decision. */
  @Column({ type: 'text', name: 'llm_reasoning', nullable: true })
  llmReasoning: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
