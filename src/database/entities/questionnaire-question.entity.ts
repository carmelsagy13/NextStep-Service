import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  LocalizedText,
  QuestionValidation,
} from './questionnaire.types.js';
import { QuestionType } from './questionnaire.types.js';
import { QuestionnaireScreen } from './questionnaire-screen.entity.js';
import { QuestionnaireOption } from './questionnaire-option.entity.js';
import { QuestionnaireDependency } from './questionnaire-dependency.entity.js';

/**
 * A single question (or conditional sub-field) within a screen.
 *
 * Nesting is expressed via `parentQuestionId` (self-reference): top-level
 * questions have a NULL parent, while conditionally-revealed sub-fields such as
 * `q_children_count` point at their owning question. Whether a sub-field is
 * actually shown is governed by rows in `questionnaire_dependencies`.
 */
@Entity('questionnaire_questions')
export class QuestionnaireQuestion {
  @PrimaryGeneratedColumn('uuid', { name: 'question_id' })
  questionId: string;

  /** Stable identifier from the spec (e.g. `q_family_status`). */
  @Column({ type: 'varchar', length: 100, name: 'question_key', unique: true })
  questionKey: string;

  @Column({ type: 'uuid', name: 'screen_id' })
  screenId: string;

  /** Owning question for nested sub-fields; NULL for top-level questions. */
  @Column({ type: 'uuid', name: 'parent_question_id', nullable: true })
  parentQuestionId: string | null;

  /** Bilingual question text. */
  @Column({ type: 'jsonb' })
  text: LocalizedText;

  @Column({ type: 'enum', enum: QuestionType })
  type: QuestionType;

  /**
   * Whether an answer is mandatory. Required-ness is only enforced when the
   * question is actually visible (top-level always; sub-fields once their
   * trigger dependency is satisfied).
   */
  @Column({ type: 'boolean', name: 'is_required', default: true })
  isRequired: boolean;

  /** Render order within the screen / parent group (ascending). */
  @Column({ type: 'int', name: 'order_index', default: 0 })
  orderIndex: number;

  /** Optional numeric/text constraints applied at ingestion time. */
  @Column({ type: 'jsonb', nullable: true })
  validation: QuestionValidation | null;

  /** Soft toggle — inactive questions are excluded from the served structure. */
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  /** Free-form extension bag (e.g. UI hints, analytics tags). */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => QuestionnaireScreen, (screen) => screen.questions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'screen_id' })
  screen: QuestionnaireScreen;

  @ManyToOne(() => QuestionnaireQuestion, (question) => question.children, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'parent_question_id' })
  parent: QuestionnaireQuestion | null;

  @OneToMany(() => QuestionnaireQuestion, (question) => question.parent)
  children: QuestionnaireQuestion[];

  @OneToMany(() => QuestionnaireOption, (option) => option.question)
  options: QuestionnaireOption[];

  /** Conditional rules that control THIS question's visibility. */
  @OneToMany(
    () => QuestionnaireDependency,
    (dependency) => dependency.question,
  )
  dependencies: QuestionnaireDependency[];
}
