import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity.js';

@Entity('financial_snapshots')
export class FinancialSnapshot {
  @PrimaryGeneratedColumn('uuid', { name: 'snapshot_id' })
  snapshotId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'monthly_income', nullable: true })
  monthlyIncome: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'monthly_expenses', nullable: true })
  monthlyExpenses: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'total_savings', nullable: true })
  totalSavings: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'total_debt', nullable: true })
  totalDebt: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
