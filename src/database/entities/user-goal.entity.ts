import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity.js';
import { RoadmapGoal } from './roadmap-goal.entity.js';

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

  @Column({ type: 'boolean', name: 'is_completed', default: false })
  isCompleted: boolean;

  @Column({ type: 'text', name: 'ai_insight', nullable: true })
  aiInsight: string;

  @ManyToOne(() => User, (user) => user.goals, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => RoadmapGoal, (roadmapGoal) => roadmapGoal.userGoals, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'roadmap_goal_id' })
  roadmapGoal: RoadmapGoal;
}
