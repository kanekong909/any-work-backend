import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn
} from 'typeorm';

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string;

  @Column()
  displayName!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  priceMonthly!: number;

  @Column({ type: 'int', default: 1 })
  maxUsers!: number;

  @Column({ type: 'int', default: 50 })
  maxExpensesPerMonth!: number;

  // Nuevos límites
  @Column({ type: 'int', default: 30 })
  maxProducts!: number; // -1 = ilimitado

  @Column({ type: 'int', default: 50 })
  maxSalesPerMonth!: number; // -1 = ilimitado

  @Column({ type: 'int', default: 10 })
  maxCustomers!: number; // -1 = ilimitado

  @Column({ type: 'jsonb', default: '{}' })
  features!: Record<string, boolean>;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}