import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AnswerValue } from './questionnaire.types.js';
import { DependencyOperator } from './questionnaire.types.js';
import { QuestionnaireQuestion } from './questionnaire-question.entity.js';

/**
 * A conditional-visibility rule. The dependent `question` is revealed when the
 * `triggerQuestion`'s submitted answer satisfies `operator` against
 * `triggerValue`.
 *
 * Boolean composition is expressed through `groupIndex`:
 *   • rules sharing the same groupIndex are AND-ed together;
 *   • different groups are OR-ed together.
 *
 * Example — "show `q_liquid_savings_estimated_amount` if `study_fund` OR
 * `provident_fund` is selected" — is two rules with the same dependent
 * question, INCLUDES operator, and DIFFERENT group indexes.
 */
@Entity('questionnaire_dependencies')
export class QuestionnaireDependency {
  @PrimaryGeneratedColumn('uuid', { name: 'dependency_id' })
  dependencyId: string;

  /** The question whose visibility this rule controls. */
  @Column({ type: 'uuid', name: 'question_id' })
  questionId: string;

  /** The question whose answer is inspected. */
  @Column({ type: 'uuid', name: 'trigger_question_id' })
  triggerQuestionId: string;

  @Column({ type: 'enum', enum: DependencyOperator })
  operator: DependencyOperator;

  /**
   * Value compared against the trigger answer. JSONB so it can hold a string,
   * a number, or (rarely) an array depending on the operator.
   */
  @Column({ type: 'jsonb', name: 'trigger_value', nullable: true })
  triggerValue: AnswerValue | null;

  /** AND within the same group; OR across groups. */
  @Column({ type: 'int', name: 'group_index', default: 0 })
  groupIndex: number;

  /** Soft toggle — inactive rules are ignored. */
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => QuestionnaireQuestion, (question) => question.dependencies, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'question_id' })
  question: QuestionnaireQuestion;

  @ManyToOne(() => QuestionnaireQuestion, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'trigger_question_id' })
  triggerQuestion: QuestionnaireQuestion;
}
