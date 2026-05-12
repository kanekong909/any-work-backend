import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  JoinColumn, CreateDateColumn, UpdateDateColumn
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { Plan } from './plan.entity';

export enum SubscriptionStatus {
  PENDING_PAYMENT = 'pending_payment', // Esperando verificación manual
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export enum PaymentMethod {
  NEQUI = 'nequi',
  BANK_TRANSFER = 'bank_transfer',
  CASH = 'cash',
  FREE = 'free',
  BOLD = 'bold',
}

@Entity('tenant_subscriptions')
export class TenantSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenantId: string;

  @ManyToOne(() => Tenant, (t) => t.subscriptions)
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  @Column()
  planId: string;

  @ManyToOne(() => Plan)
  @JoinColumn({ name: 'planId' })
  plan: Plan;

  @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.PENDING_PAYMENT })
  status: SubscriptionStatus;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.FREE })
  paymentMethod: PaymentMethod;

  // Comprobante de pago (URL a imagen subida)
  @Column({ nullable: true })
  paymentProofUrl: string;

  // Notas del admin al verificar
  @Column({ nullable: true })
  adminNotes: string;

  @Column({ nullable: true })
  activatedAt: Date;

  @Column({ nullable: true })
  expiresAt: Date; // 30 días después de activar

  // Quién activó (superadmin)
  @Column({ nullable: true })
  activatedById: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  amountPaid: number; // COP

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
