import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * Per-criteria detail attached to a roadmap step.
 *
 * Each of the 8 financial criteria carries its own definition for a given step
 * so the LLM has explicit, criteria-scoped context when determining the user's
 * current step per dimension and assigning relevant goals:
 *  - description: short human-readable definition of this criteria at this step.
 *  - openFinanceParameters: bank/Open-Finance derived parameters (name → value).
 *  - questionnaireParameters: questionnaire-derived parameters (name → value).
 */
export interface CriteriaDetail {
  description?: string;
  openFinanceParameters?: Record<string, unknown>;
  questionnaireParameters?: Record<string, unknown>;
}

@Entity('roadmap_steps')
export class RoadmapStep {
  @PrimaryColumn({ type: 'int', name: 'step_id' })
  stepId: number;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'title_he' })
  titleHe: string | null;

  @Column({ type: 'text', nullable: true })
  description: string;

  // ── 8 granular criteria (one JSONB definition per dimension) ───────────
  @Column({ type: 'jsonb', nullable: true })
  loans: CriteriaDetail | null;

  @Column({ type: 'jsonb', nullable: true })
  mortgage: CriteriaDetail | null;

  @Column({ type: 'jsonb', nullable: true, name: 'cash_flow' })
  cashFlow: CriteriaDetail | null;

  @Column({ type: 'jsonb', nullable: true, name: 'lifestyle_clubs' })
  lifestyleClubs: CriteriaDetail | null;

  @Column({ type: 'jsonb', nullable: true, name: 'pension_long_term' })
  pensionLongTerm: CriteriaDetail | null;

  @Column({ type: 'jsonb', nullable: true, name: 'system_indicators' })
  systemIndicators: CriteriaDetail | null;

  @Column({ type: 'jsonb', nullable: true, name: 'credit_consumption' })
  creditConsumption: CriteriaDetail | null;

  @Column({ type: 'jsonb', nullable: true, name: 'savings_investments' })
  savingsInvestments: CriteriaDetail | null;
}
