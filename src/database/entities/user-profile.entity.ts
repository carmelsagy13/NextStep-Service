import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity.js';

@Entity('user_profiles')
export class UserProfile {
  @PrimaryGeneratedColumn('uuid', { name: 'profile_id' })
  profileId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'int', nullable: true })
  age: number;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'risk_tolerance' })
  riskTolerance: string;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'knowledge_level' })
  knowledgeLevel: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  occupation: string;

  @OneToOne(() => User, (user) => user.profile)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
