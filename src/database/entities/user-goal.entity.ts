import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity.js';

@Entity('user_goals')
export class UserGoal {
  @PrimaryGeneratedColumn('uuid', { name: 'goal_id' })
  goalId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 100, name: 'goal_name' })
  goalName: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'target_amount', nullable: true })
  targetAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'current_amount', default: 0 })
  currentAmount: number;

  @Column({ type: 'date', name: 'target_date', nullable: true })
  targetDate: Date;

  @ManyToOne(() => User, (user) => user.goals, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
