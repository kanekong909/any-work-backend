import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  JoinColumn, CreateDateColumn, UpdateDateColumn
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { Category } from './category.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  sku: string; // Código de referencia

  @Column({ nullable: true })
  imageUrl: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  costPrice: number; // Precio de costo

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  salePrice: number; // Precio de venta

  @Column({ type: 'decimal', precision: 10, scale: 3, default: 0 })
  stock: number; // Soporta decimales (kg, litros, etc.)

  @Column({ type: 'decimal', precision: 10, scale: 3, default: 0 })
  minStock: number; // Stock mínimo para alerta

  @Column({ default: 'unit' })
  unit: string; // 'unit' | 'kg' | 'liter' | 'gram' | 'meter'

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  categoryId: string;

  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'categoryId' })
  category: Category;

  @Column()
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
