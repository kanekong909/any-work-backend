import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  OneToMany, JoinColumn, CreateDateColumn
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Product } from '../products/product.entity';

export enum SaleStatus {
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export enum PaymentType {
  CASH = 'cash',
  CARD = 'card',
  TRANSFER = 'transfer',
  NEQUI = 'nequi',
  CREDIT = 'credit', // Fiar / crédito
}

@Entity('sales')
export class Sale {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, default: () => 'gen_random_uuid()' })
  saleNumber!: string; 

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total!: number;

  @Column({ type: 'enum', enum: PaymentType, default: PaymentType.CASH })
  paymentType!: PaymentType;

  @Column({ type: 'enum', enum: SaleStatus, default: SaleStatus.COMPLETED })
  status!: SaleStatus;

  @Column({ nullable: true })
  customerName!: string;

  @Column({ nullable: true })
  notes!: string;

  @OneToMany(() => SaleItem, (item) => item.sale, { cascade: true, eager: true })
  items!: SaleItem[];

  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  @Column()
  cashierId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'cashierId' })
  cashier!: User;

  // Cambia el tipo de timestamp a timestamptz
  @Column({ 
    type: 'timestamptz',  
    default: () => 'NOW()',
    nullable: false
  })
  createdAt!: Date;
}

@Entity('sale_items')
export class SaleItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  saleId!: string;

  @ManyToOne(() => Sale, (sale) => sale.items)
  @JoinColumn({ name: 'saleId' })
  sale!: Sale;

  @Column()
  productId!: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'productId' })
  product!: Product;

  @Column()
  productName!: string; // Snapshot del nombre al momento de venta

  @Column({ type: 'decimal', precision: 10, scale: 3 })
  quantity! : number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitPrice!: number; // Snapshot del precio al momento de venta

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal!: number;
}
