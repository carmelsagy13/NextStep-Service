import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('roadmap_steps')
export class RoadmapStep {
  @PrimaryColumn({ type: 'int', name: 'step_id' })
  stepId: number;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  criteria: Record<string, any>;
}
