import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { UserGoal } from './user-goal.entity.js';

export enum RoadmapGoalType {
  PERSONAL = 'personal',
  MARKETING = 'marketing',
}

@Entity('roadmap_goals')
export class RoadmapGoal {
  @PrimaryGeneratedColumn('uuid', { name: 'goal_id' })
  goalId: string;

  @Column({ type: 'int', name: 'step_id' })
  stepId: number;

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

  @OneToMany(() => UserGoal, (userGoal) => userGoal.roadmapGoal)
  userGoals: UserGoal[];
}
