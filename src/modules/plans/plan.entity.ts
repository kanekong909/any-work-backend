import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn
} from 'typeorm';

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string; // 'free' | 'pro' | 'business'

  @Column()
  displayName: string; // 'Free' | 'Pro' | 'Business'

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  priceMonthly: number; // COP

  @Column({ type: 'int', default: 1 })
  maxUsers: number;

  @Column({ type: 'int', default: 50 })
  maxExpensesPerMonth: number; // -1 = ilimitado

  @Column({ type: 'jsonb', default: '{}' })
  features: Record<string, boolean>; // módulos habilitados

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
