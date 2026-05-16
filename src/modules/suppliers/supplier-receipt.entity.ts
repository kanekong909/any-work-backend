import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  OneToMany, JoinColumn, CreateDateColumn
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { Supplier } from './supplier.entity';
import { User } from '../users/user.entity';

export enum ReceiptStatus {
  COMPLETE = 'complete',
  PARTIAL = 'partial',
  DAMAGED = 'damaged',
}

@Entity('supplier_receipts')
export class SupplierReceipt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  @Column({ nullable: true })
  supplierId!: string;

  @ManyToOne(() => Supplier, { nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier!: Supplier;

  @Column({ type: 'enum', enum: ReceiptStatus, default: ReceiptStatus.COMPLETE })
  status!: ReceiptStatus;

  @Column({ nullable: true })
  invoiceNumber: string; // Número de factura o remisión del proveedor

  @Column({ nullable: true })
  notes: string;

  @Column()
  receivedById!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'receivedById' })
  receivedBy!: User;

  @OneToMany(() => SupplierReceiptItem, item => item.receipt, { cascade: true, eager: true })
  items!: SupplierReceiptItem[];

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('supplier_receipt_items')
export class SupplierReceiptItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  receiptId!: string;

  @ManyToOne(() => SupplierReceipt, r => r.items)
  @JoinColumn({ name: 'receiptId' })
  receipt!: SupplierReceipt;

  @Column()
  productName!: string; // Nombre del producto recibido

  @Column({ nullable: true })
  productId: string; // Opcional — si está en inventario

  @Column({ type: 'decimal', precision: 10, scale: 3 })
  quantity!: number;

  @Column({ default: 'unit' })
  unit!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  unitCost!: number; // Costo unitario pagado

  @Column({ nullable: true })
  condition: string; // 'bueno', 'dañado', 'incompleto'

  @Column({ nullable: true })
  notes: string;
}