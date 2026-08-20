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
import type { AnswerValue } from './questionnaire.types.js';
import { QuestionnaireQuestion } from './questionnaire-question.entity.js';
import { QuestionnaireSubmission } from './questionnaire-submission.entity.js';

/**
 * A single user's answer to a single question. Upserted on the
 * (user_id, question_id) pair so re-submitting overwrites in place rather than
 * accumulating duplicates. `answerValue` is JSONB and uniformly stores the
 * shape appropriate to the question type (string / string[] / number).
 */
@Entity('questionnaire_responses')
@Unique('uq_response_user_question', ['userId', 'questionId'])
export class QuestionnaireResponse {
  @PrimaryGeneratedColumn('uuid', { name: 'response_id' })
  responseId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'question_id' })
  questionId: string;

  /** Optional link to the submission header this answer belongs to. */
  @Column({ type: 'uuid', name: 'submission_id', nullable: true })
  submissionId: string | null;

  /** The persisted answer; shape depends on the question's type. */
  @Column({ type: 'jsonb', name: 'answer_value' })
  answerValue: AnswerValue;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => QuestionnaireQuestion, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'question_id' })
  question: QuestionnaireQuestion;

  @ManyToOne(
    () => QuestionnaireSubmission,
    (submission) => submission.responses,
    {
      onDelete: 'SET NULL',
      nullable: true,
    },
  )
  @JoinColumn({ name: 'submission_id' })
  submission: QuestionnaireSubmission | null;
}
