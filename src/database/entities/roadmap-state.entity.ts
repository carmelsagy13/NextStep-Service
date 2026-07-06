import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity.js';
import type { LossAversionResult } from '../../loss-aversion/loss-aversion.types.js';

@Entity('roadmap_states')
export class RoadmapState {
  @PrimaryGeneratedColumn('uuid', { name: 'state_id' })
  stateId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'int', name: 'progress_percent', default: 0 })
  progressPercent: number;

  @Column({ type: 'text', name: 'state_description', nullable: true })
  stateDescription: string;

  /**
   * Latest computed loss-aversion projection (money missed by not advancing to
   * the next stage). Populated by the Open Finance analysis pipeline; surfaced
   * via GET /roadmap. Null until the first analysis runs.
   */
  @Column({ type: 'jsonb', name: 'loss_aversion', nullable: true })
  lossAversion: LossAversionResult | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
