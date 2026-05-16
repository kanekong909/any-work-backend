import 'reflect-metadata';
import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
import { User } from '../modules/users/user.entity';
import { Tenant } from '../modules/tenants/tenant.entity';
import { Plan } from '../modules/plans/plan.entity';
import { TenantSubscription } from '../modules/plans/tenant-subscription.entity';
import { Product } from '../modules/products/product.entity';
import { Category } from '../modules/products/category.entity';
import { Expense } from '../modules/expenses/expense.entity';
import { Sale, SaleItem } from '../modules/sales/sale.entity';
import { Customer } from '../modules/customers/customer.entity';
import { Supplier } from '../modules/suppliers/supplier.entity';
import { AuditLog } from '../modules/audit/audit-log.entity';
import { SupplierReceipt, SupplierReceiptItem } from '../modules/suppliers/supplier-receipt.entity';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  entities: [
    User,
    Tenant,
    Plan,
    TenantSubscription,
    Product,
    Category,
    Expense,
    Sale,
    SaleItem,
    Customer,
    Supplier,
    AuditLog,
    SupplierReceipt,
    SupplierReceiptItem
  ],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: process.env.NODE_ENV === 'development', // Solo en dev
  logging: process.env.NODE_ENV === 'development',
});
