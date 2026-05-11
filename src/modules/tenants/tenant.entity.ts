import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany
} from 'typeorm';
import { User } from '../users/user.entity';
import { TenantSubscription } from '../plans/tenant-subscription.entity';

export enum BusinessType {
  BAKERY = 'bakery',           // Panadería
  PASTRY = 'pastry',           // Repostería
  HARDWARE = 'hardware',       // Ferretería
  RESTAURANT = 'restaurant',   // Restaurante
  BOUTIQUE = 'boutique',       // Boutique / Ropa
  SERVICES = 'services',       // Servicios
  GROCERY = 'grocery',         // Tienda / Abarrotes
  PHARMACY = 'pharmacy',       // Farmacia
  OTHER = 'other',             // Otro
}

export enum TenantStatus {
  PENDING = 'pending',         // Recién registrado, sin activar
  ACTIVE = 'active',           // Plan activo
  SUSPENDED = 'suspended',     // Pago vencido
  CANCELLED = 'cancelled',     // Cancelado
}

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Identidad del negocio ──────────────────────────────────
  @Column({ unique: true })
  slug: string; // nexoadmin.com/app/panaderia-juan → URL-friendly

  @Column()
  businessName: string;

  @Column({ type: 'enum', enum: BusinessType, nullable: true })
  businessType: BusinessType;

  @Column({ nullable: true })
  logoUrl: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  taxId: string; // NIT o cédula

  // ── Personalización visual ─────────────────────────────────
  @Column({ default: '#6366f1' })
  primaryColor: string;

  @Column({ default: '#8b5cf6' })
  accentColor: string;

  @Column({ default: 'light' })
  colorTheme: string; // 'light' | 'dark'

  // ── Estado ─────────────────────────────────────────────────
  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.PENDING })
  status: TenantStatus;

  @Column({ nullable: true })
  activatedAt: Date;

  @Column({ nullable: true })
  suspendedAt: Date;

  // ── Módulos habilitados (por plan) ─────────────────────────
  @Column({ type: 'jsonb', default: '{}' })
  enabledModules: Record<string, boolean>;

  // ── Onboarding ─────────────────────────────────────────────
  @Column({ default: false })
  onboardingCompleted: boolean;

  @Column({ type: 'int', default: 1 })
  onboardingStep: number; // último paso completado

  // ── Relaciones ─────────────────────────────────────────────
  @OneToMany(() => User, (user) => user.tenant)
  users: User[];

  @OneToMany(() => TenantSubscription, (sub) => sub.tenant)
  subscriptions: TenantSubscription[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
