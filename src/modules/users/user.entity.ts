import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';

export enum UserRole {
  SUPERADMIN = 'superadmin', // Tú — acceso total
  ADMIN = 'admin',           // Dueño del negocio
  CASHIER = 'cashier',       // Cajero
  WAREHOUSE = 'warehouse',   // Bodega / Inventario
  SUPERVISOR = 'supervisor', // Ve reportes pero no edita
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true, transformer: {
    to: (val: string) => val?.toLowerCase().trim(),
    from: (val: string) => val,
  }})
  email: string;

  @Column({ select: false }) // No se retorna en queries por defecto
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.ADMIN })
  role: UserRole;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  lastLoginAt: Date;

  @Column({ nullable: true })
  refreshToken: string;

  // Tenant al que pertenece (null = superadmin)
  @Column({ nullable: true })
  tenantId: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.users, { nullable: true })
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
