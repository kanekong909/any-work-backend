import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  JoinColumn, CreateDateColumn, UpdateDateColumn, BeforeUpdate, BeforeInsert
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { Category } from './category.entity';

@Entity('products')
export class Product {
  @BeforeInsert()
  @BeforeUpdate()
  normalizeStock() {
    // Si el producto es por unidad, forzar stock entero
    if (this.unit === 'unit' && this.stock) {
      this.stock = Math.round(this.stock);
    }
    
    // Para otros tipos, mantener 3 decimales
    if (this.unit !== 'unit' && this.stock) {
      this.stock = Math.round(this.stock * 1000) / 1000;
    }
  }

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

  @Column({ 
    type: 'decimal', 
    precision: 10, 
    scale: 3, 
    default: 0,
    transformer: {
        to: (value: number) => value,
        from: (value: string) => parseFloat(parseFloat(value).toFixed(3))
      }
  })
  stock: number;

  @Column({ 
    type: 'decimal', 
    precision: 10, 
    scale: 3, 
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(parseFloat(value).toFixed(3))
    }
  })
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
