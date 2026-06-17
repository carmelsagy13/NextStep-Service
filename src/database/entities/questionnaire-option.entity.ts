import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { LocalizedText } from './questionnaire.types.js';
import { QuestionnaireQuestion } from './questionnaire-question.entity.js';

/**
 * A selectable choice for a SINGLE_CHOICE or MULTIPLE_CHOICE question.
 * `optionValue` is the machine value persisted in answers; `label` is the
 * bilingual text rendered to the user.
 */
@Entity('questionnaire_options')
@Unique('uq_option_question_value', ['questionId', 'optionValue'])
export class QuestionnaireOption {
  @PrimaryGeneratedColumn('uuid', { name: 'option_id' })
  optionId: string;

  @Column({ type: 'uuid', name: 'question_id' })
  questionId: string;

  /** Stable machine value stored in user answers (e.g. `yes`, `study_fund`). */
  @Column({ type: 'varchar', length: 100, name: 'option_value' })
  optionValue: string;

  /** Bilingual choice label. */
  @Column({ type: 'jsonb' })
  label: LocalizedText;

  /** Render order within the question (ascending). */
  @Column({ type: 'int', name: 'order_index', default: 0 })
  orderIndex: number;

  /** Soft toggle — inactive options are excluded from the served structure. */
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  /** Free-form extension bag (e.g. icon keys, scoring weights). */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => QuestionnaireQuestion, (question) => question.options, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'question_id' })
  question: QuestionnaireQuestion;
}
