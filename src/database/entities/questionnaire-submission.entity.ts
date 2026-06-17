import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SubmissionStatus } from './questionnaire.types.js';
import { QuestionnaireResponse } from './questionnaire-response.entity.js';

/**
 * Optional audit header grouping a user's answers for one onboarding pass.
 * Individual answers are upserted per question; this header records the
 * lifecycle/version of the overall submission for traceability.
 */
@Entity('questionnaire_submissions')
export class QuestionnaireSubmission {
  @PrimaryGeneratedColumn('uuid', { name: 'submission_id' })
  submissionId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** Incrementing pass number for the same user (re-onboarding). */
  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({
    type: 'enum',
    enum: SubmissionStatus,
    default: SubmissionStatus.SUBMITTED,
  })
  status: SubmissionStatus;

  @Column({ type: 'timestamp', name: 'submitted_at', nullable: true })
  submittedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => QuestionnaireResponse, (response) => response.submission)
  responses: QuestionnaireResponse[];
}
