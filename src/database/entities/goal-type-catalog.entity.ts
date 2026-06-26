import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import type { LocalizedText } from './questionnaire.types.js';
import { UserAspiration } from './user-aspiration.entity.js';

/**
 * Declarative description of a single attribute a goal type accepts. Stored as
 * part of {@link GoalTypeCatalog.attributeSchema}. The aspirations service uses
 * it to validate the free-form `attributes` JSONB on each {@link UserAspiration}
 * so new goal types (and their fields) can be introduced with DATA ONLY — no
 * schema migration or code change.
 */
export interface GoalAttributeSpec {
  /** Stable machine key stored inside UserAspiration.attributes. */
  key: string;
  /** Value kind the service coerces/validates against. */
  type: 'number' | 'string' | 'boolean' | 'date' | 'string[]';
  /** When true the aspiration cannot be saved without this attribute. */
  required?: boolean;
  /** Optional bilingual label for clients rendering a dynamic form. */
  label?: LocalizedText;
}

/**
 * Catalog of the overarching financial goal TYPES a user can declare (e.g. a
 * car purchase, wedding, home equity, safety net). This is the data-driven
 * replacement for the hard-coded `q_financial_goals` option list: adding a new
 * goal type — and the dynamic fields it carries — is now an INSERT here, not a
 * questionnaire schema change.
 *
 * A row defines WHAT a goal type is and which dynamic attributes it accepts;
 * the per-user instance lives in {@link UserAspiration}.
 */
@Entity('goal_type_catalog')
export class GoalTypeCatalog {
  /** Stable machine code, e.g. `car_purchase`. Mirrors the old option value. */
  @PrimaryColumn({ type: 'varchar', length: 100, name: 'code' })
  code: string;

  /** Bilingual display label (he authoritative, en optional). */
  @Column({ type: 'jsonb', name: 'label' })
  label: LocalizedText;

  /** Optional grouping bucket (e.g. `short_term`, `long_term`). */
  @Column({ type: 'varchar', length: 50, nullable: true })
  category: string | null;

  /** Whether a monetary target_amount is meaningful for this goal type. */
  @Column({ type: 'boolean', name: 'supports_amount', default: true })
  supportsAmount: boolean;

  /** Whether a timeframe / target_date is meaningful for this goal type. */
  @Column({ type: 'boolean', name: 'supports_timeframe', default: true })
  supportsTimeframe: boolean;

  /**
   * Declarative list of dynamic attributes this goal type accepts, validated
   * against UserAspiration.attributes. Empty/null = no extra attributes.
   */
  @Column({ type: 'jsonb', name: 'attribute_schema', nullable: true })
  attributeSchema: GoalAttributeSpec[] | null;

  /** Default ordering hint when surfacing goal types in the UI. */
  @Column({ type: 'int', name: 'default_priority', default: 0 })
  defaultPriority: number;

  /** Soft-delete toggle: inactive types are hidden but never break history. */
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => UserAspiration, (aspiration) => aspiration.goalType)
  aspirations: UserAspiration[];
}
