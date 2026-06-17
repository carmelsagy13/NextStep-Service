import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { LocalizedText } from './questionnaire.types.js';
import { QuestionnaireQuestion } from './questionnaire-question.entity.js';

/**
 * A logical page/section of the onboarding flow (e.g. "Family Status").
 * Screens are content rows — adding, reordering or deactivating a screen is a
 * pure data operation, never a code or schema change.
 */
@Entity('questionnaire_screens')
export class QuestionnaireScreen {
  @PrimaryGeneratedColumn('uuid', { name: 'screen_id' })
  screenId: string;

  /** Stable human-readable identifier (e.g. `screen_family_status`). */
  @Column({ type: 'varchar', length: 100, name: 'screen_key', unique: true })
  screenKey: string;

  /** Render order across the flow (ascending). */
  @Column({ type: 'int', name: 'order_index', default: 0 })
  orderIndex: number;

  /** Bilingual screen title. */
  @Column({ type: 'jsonb' })
  title: LocalizedText;

  /** Optional bilingual subtitle / helper text. */
  @Column({ type: 'jsonb', nullable: true })
  subtitle: LocalizedText | null;

  /** Soft toggle — inactive screens are excluded from the served structure. */
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  /** Free-form extension bag for future configuration. */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => QuestionnaireQuestion, (question) => question.screen)
  questions: QuestionnaireQuestion[];
}
