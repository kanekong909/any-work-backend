import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN'
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' }) // 👈 CORRECCIÓN 1: Forzar tipo uuid para que coincida con Postgres
  tenantId!: string;

  @Column({ type: 'uuid', nullable: true }) // 👈 CORRECCIÓN 2: Forzar tipo uuid y permitir nulos para el onDelete
  userId!: string | null;

  @Column()
  userName!: string;

  // 👈 CORRECCIÓN 3: Especificar el nombre exacto del enum que ya existe en la BD
  @Column({ type: 'enum', enum: AuditAction, name: 'action', enumName: 'audit_logs_action_enum' }) 
  action!: AuditAction;

  @Column()
  module!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ 
      type: 'timestamptz',  // Mismo tipo que usaste en sales
      default: () => 'NOW()',
      nullable: false
    })
  createdAt!: Date;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user!: User;
}
