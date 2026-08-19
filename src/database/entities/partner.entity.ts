import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PartnerOffer } from './partner-offer.entity.js';

/**
 * A commercial partner (e.g. Phoenix, Migdal) whose sponsored products can be
 * surfaced to users through MARKETING roadmap goals. Holds only branding — the
 * commercial terms of a campaign live in {@link PartnerOffer}.
 */
@Entity('partners')
export class Partner {
  @PrimaryGeneratedColumn('uuid', { name: 'partner_id' })
  partnerId: string;

  /** Stable machine key used by seeds and asset folder names (e.g. `phoenix`). */
  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 120, name: 'name_he' })
  nameHe: string;

  /**
   * Path RELATIVE to the static asset root (e.g. `partners/phoenix/logo.svg`),
   * so the absolute URL can differ per environment. An absolute http(s) URL is
   * also accepted for partner-hosted assets.
   */
  @Column({ type: 'varchar', length: 255, name: 'logo_path' })
  logoPath: string;

  /** Hex accent colour used for the card border/badge on the client. */
  @Column({ type: 'varchar', length: 9, name: 'brand_color', nullable: true })
  brandColor: string | null;

  @Column({ type: 'text', name: 'website_url', nullable: true })
  websiteUrl: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => PartnerOffer, (offer) => offer.partner)
  offers: PartnerOffer[];
}
