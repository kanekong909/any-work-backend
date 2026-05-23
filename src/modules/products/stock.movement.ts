// src/modules/inventory/stock-movement.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  JoinColumn, CreateDateColumn, UpdateDateColumn, Index
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { Product } from '../products/product.entity';
import { User } from '../users/user.entity';

export enum MovementType {
  IN = 'IN',
  OUT = 'OUT',
  ADJUSTMENT = 'ADJUSTMENT'
}

export enum MovementReason {
  PURCHASE = 'PURCHASE',
  SALE = 'SALE',
  INVENTORY_ADJUSTMENT = 'INVENTORY_ADJUSTMENT',
  DAMAGED = 'DAMAGED',
  EXPIRED = 'EXPIRED',
  CUSTOMER_RETURN = 'CUSTOMER_RETURN',
  SUPPLIER_RETURN = 'SUPPLIER_RETURN',
  INITIAL_STOCK = 'INITIAL_STOCK',
  SUPPLIER_RECEIPT = 'SUPPLIER_RECEIPT' // 👈 Nueva razón para recepciones
}

@Entity('stock_movements')
@Index(['tenantId', 'productId', 'createdAt'])
export class StockMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  productId: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'enum', enum: MovementType })
  movementType: MovementType;

  @Column({ type: 'enum', enum: MovementReason })
  reason: MovementReason;

  @Column({ type: 'decimal', precision: 10, scale: 3 })
  quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 3 })
  stockBefore: number;

  @Column({ type: 'decimal', precision: 10, scale: 3 })
  stockAfter: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  unitCost: number;

  @Column({ type: 'text', nullable: true })
  referenceId: string | null; // ID de la recepción, factura, etc.

  @Column({ type: 'varchar', nullable: true })
  referenceType: string; // 'supplier_receipt', 'sale', 'adjustment'

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ nullable: true })
  userId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}