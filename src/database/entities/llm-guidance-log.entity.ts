import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from './user.entity.js';

@Entity('llm_guidance_logs')
export class LlmGuidanceLog {
  @PrimaryGeneratedColumn('uuid', { name: 'log_id' })
  logId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'jsonb', name: 'context_snapshot', nullable: true })
  contextSnapshot: Record<string, any>;

  @Column({ type: 'text', name: 'guidance_text', nullable: true })
  guidanceText: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
