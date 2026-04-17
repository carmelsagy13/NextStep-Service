import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('notification_templates')
export class NotificationTemplate {
  @PrimaryColumn({ type: 'varchar', length: 50, name: 'template_id' })
  templateId: string;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string;

  @Column({ type: 'varchar', length: 50, name: 'trigger_type' })
  triggerType: string;
}
