import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../../config/data-source';
import { Plan } from '../../modules/plans/plan.entity';
import { User, UserRole } from '../../modules/users/user.entity';

const FREE_MODULES = {
  dashboard: true,
  inventory: true,
  sales: true,
  expenses: true,
  customers: false,
  suppliers: false,
  reports: false,
};

const PRO_MODULES = {
  dashboard: true,
  inventory: true,
  sales: true,
  expenses: true,
  customers: true,
  suppliers: true,
  reports: true,
};

const BUSINESS_MODULES = {
  ...PRO_MODULES,
  multiLocation: true,
  api: true,
  advancedReports: true,
};

async function seed() {
  await AppDataSource.initialize();
  console.log('🌱 Iniciando seed...');

  const planRepo = AppDataSource.getRepository(Plan);
  const userRepo = AppDataSource.getRepository(User);

  // ── Planes ─────────────────────────────────────────────────
  const plans = [
    {
      name: 'free',
      displayName: 'Free',
      priceMonthly: 0,
      maxUsers: 1,
      maxExpensesPerMonth: 50,
      maxProducts: 30,
      maxSalesPerMonth: 50,
      maxCustomers: 10,
      features: FREE_MODULES,
    },
    {
      name: 'pro',
      displayName: 'Pro',
      priceMonthly: 35000,
      maxUsers: 5,
      maxExpensesPerMonth: -1,
      maxProducts: 300,
      maxSalesPerMonth: -1,
      maxCustomers: -1,
      features: PRO_MODULES,
    },
    {
      name: 'business',
      displayName: 'Business',
      priceMonthly: 80000,
      maxUsers: -1,
      maxExpensesPerMonth: -1,
      maxProducts: -1,
      maxSalesPerMonth: -1,
      maxCustomers: -1,
      features: BUSINESS_MODULES,
    },
  ];

  for (const planData of plans) {
    const existing = await planRepo.findOne({ where: { name: planData.name } });
    if (!existing) {
      await planRepo.save(planRepo.create(planData));
      console.log(`  ✅ Plan "${planData.displayName}" creado`);
    } else {
      await planRepo.save({ ...existing, ...planData });
      console.log(`  🔄 Plan "${planData.displayName}" actualizado`);
    }
  }

  // ── Superadmin ─────────────────────────────────────────────
  const adminEmail = process.env.SUPERADMIN_EMAIL || 'admin@nexoadmin.co';
  const existingAdmin = await userRepo.findOne({ where: { email: adminEmail } });

  if (!existingAdmin) {
    const password = process.env.SUPERADMIN_PASSWORD || 'Admin123!';
    const hashed = await bcrypt.hash(password, 12);
    await userRepo.save(userRepo.create({
      name: 'Super Admin',
      email: adminEmail,
      password: hashed,
      role: UserRole.SUPERADMIN,
      isActive: true,
    }));
    console.log(`  ✅ Superadmin creado: ${adminEmail}`);
    console.log(`  ⚠️  IMPORTANTE: Cambia la contraseña en producción`);
  } else {
    console.log(`  ⏭  Superadmin ya existe`);
  }

  console.log('\n✨ Seed completado');
  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error('❌ Error en seed:', err);
  process.exit(1);
});
