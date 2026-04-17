import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { BankConsent } from './bank-consent.entity.js';

@Entity('bank_tokens')
export class BankToken {
  @PrimaryGeneratedColumn('uuid', { name: 'token_id' })
  tokenId: string;

  @Column({ type: 'uuid', name: 'consent_id' })
  consentId: string;

  @Column({ type: 'text', name: 'access_token_enc' })
  accessTokenEnc: string;

  @Column({ type: 'text', name: 'refresh_token_enc', nullable: true })
  refreshTokenEnc: string;

  @OneToOne(() => BankConsent)
  @JoinColumn({ name: 'consent_id' })
  consent: BankConsent;
}
