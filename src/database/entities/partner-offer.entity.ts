import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Partner } from './partner.entity.js';

/**
 * Declarative conditions describing which users an offer suits. Consumed by
 * `isMarketingGoalAllowed` (deterministic gate) and rendered into the LLM task
 * bank as a hint. Every field is optional — an empty object means "no targeting".
 */
export interface PartnerOfferTargeting {
  /** Minimum overall roadmap step the user must have reached. */
  minStep?: number;
  /** Maximum overall roadmap step the offer stays relevant for. */
  maxStep?: number;
  /** Minimum monthly discretionary surplus (ILS) the offer requires. */
  minMonthlySurplus?: number;
  /** Minimum idle liquid balance (ILS) the offer requires. */
  minIdleBalance?: number;
  /** When true (default), the offer is withheld from users showing distress flags. */
  requiresNoDistressFlags?: boolean;
}

/**
 * A time-bound commercial campaign belonging to a {@link Partner}: the headline,
 * the exclusive terms, the affiliate CTA link and the compliance disclaimer.
 *
 * Kept separate from `roadmap_goals` because one partner runs several campaigns
 * that expire and change terms independently of the goal copy, and several goal
 * templates may point at the same offer. `roadmap_goals` remains the single
 * place goals are authored; it merely references the offer.
 */
@Entity('partner_offers')
export class PartnerOffer {
  @PrimaryGeneratedColumn('uuid', { name: 'offer_id' })
  offerId: string;

  @Column({ type: 'uuid', name: 'partner_id' })
  partnerId: string;

  /** Stable machine key, also the analytics handle exposed to the client. */
  @Column({ type: 'varchar', length: 80, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 160, name: 'headline_he' })
  headlineHe: string;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'subheadline_he',
    nullable: true,
  })
  subheadlineHe: string | null;

  /** Short promotional chips, e.g. `["0% דמי ניהול לשנה"]`. */
  @Column({ type: 'jsonb', name: 'benefit_tags', nullable: true })
  benefitTags: string[] | null;

  @Column({ type: 'varchar', length: 60, name: 'cta_label_he' })
  ctaLabelHe: string;

  /** Affiliate / deep link. Must be https — validated again before serialization. */
  @Column({ type: 'text', name: 'cta_url' })
  ctaUrl: string;

  /** Optional wide banner, relative to the static asset root like `logo_path`. */
  @Column({ type: 'varchar', length: 255, name: 'banner_path', nullable: true })
  bannerPath: string | null;

  /** Regulatory disclosure text. Required for the offer to be served. */
  @Column({ type: 'text', name: 'disclaimer_he', nullable: true })
  disclaimerHe: string | null;

  @Column({ type: 'date', name: 'valid_from', nullable: true })
  validFrom: string | null;

  @Column({ type: 'date', name: 'valid_until', nullable: true })
  validUntil: string | null;

  @Column({ type: 'jsonb', nullable: true })
  targeting: PartnerOfferTargeting | null;

  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Partner, (partner) => partner.offers, {
    onDelete: 'RESTRICT',
    eager: true,
  })
  @JoinColumn({ name: 'partner_id' })
  partner: Partner;
}
