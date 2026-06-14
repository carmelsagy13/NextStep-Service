import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity.js';

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

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
