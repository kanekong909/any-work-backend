import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  JoinColumn, CreateDateColumn, UpdateDateColumn
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Supplier } from '../suppliers/supplier.entity';

export enum ExpenseCategory {
  SUPPLIES = 'supplies',         // Insumos / Materia prima
  UTILITIES = 'utilities',       // Servicios públicos
  RENT = 'rent',                 // Arriendo
  SALARY = 'salary',             // Nómina
  TRANSPORT = 'transport',       // Transporte
  MAINTENANCE = 'maintenance',   // Mantenimiento
  MARKETING = 'marketing',       // Publicidad
  OTHER = 'other',               // Otro
}

@Entity('expenses')
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number; // COP

  @Column({ type: 'enum', enum: ExpenseCategory, default: ExpenseCategory.OTHER })
  category: ExpenseCategory;

  @Column({ type: 'date' })
  date: string; // YYYY-MM-DD

  @Column({ nullable: true })
  receiptUrl: string; // Foto del recibo

  @Column({ nullable: true })
  notes: string;

  // ── RELACIÓN CON PROVEEDORES ──────────────────────────────────
  @Column({ type: 'uuid', nullable: true }) // 👈 2. Columna física de llave foránea
  supplierId: string | null;

  @ManyToOne(() => Supplier, { nullable: true, onDelete: 'SET NULL' }) // 👈 3. Mapeo de la relación
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier | null;
  // ──────────────────────────────────────────────────────────────

  @Column()
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  @Column()
  createdById: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
