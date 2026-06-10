import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity.js';

@Entity('user_profiles')
export class UserProfile {
  @PrimaryGeneratedColumn('uuid', { name: 'profile_id' })
  profileId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  // ── Overall roadmap stage ──────────────────────────────────────────────
  @Column({ type: 'int', nullable: true, name: 'current_step' })
  currentStep: number;

  // ── 8 Granular criteria (stage 1–5 per dimension) ─────────────────────
  @Column({ type: 'int', nullable: true, name: 'cash_flow' })
  cashFlow: number;

  @Column({ type: 'int', nullable: true, name: 'credit_consumption' })
  creditConsumption: number;

  @Column({ type: 'int', nullable: true })
  loans: number;

  @Column({ type: 'int', nullable: true, name: 'savings_investments' })
  savingsInvestments: number;

  @Column({ type: 'int', nullable: true, name: 'pension_long_term' })
  pensionLongTerm: number;

  @Column({ type: 'int', nullable: true, name: 'lifestyle_clubs' })
  lifestyleClubs: number;

  @Column({ type: 'int', nullable: true })
  mortgage: number;

  @Column({ type: 'int', nullable: true, name: 'system_indicators' })
  systemIndicators: number;

  // ── Demographic & context fields ──────────────────────────────────────
  @Column({ type: 'int', nullable: true })
  age: number;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    name: 'risk_tolerance',
  })
  riskTolerance: string;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    name: 'knowledge_level',
  })
  knowledgeLevel: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  occupation: string;

  // ── Audit timestamps ──────────────────────────────────────────────────
  /** Set automatically when the profile row is first created. */
  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  /** Refreshed automatically every time the profile row is modified. */
  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => User, (user) => user.profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
