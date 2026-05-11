import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { Expense } from './expense.entity';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { resolveTenant, checkModule } from '../../shared/middleware/tenant.middleware';
import { TenantSubscription, SubscriptionStatus } from '../plans/tenant-subscription.entity';
import { Between } from 'typeorm';
import { logAction } from '../../shared/utils/audit';
import { AuditAction } from '../audit/audit-log.entity';
import { User } from '../users/user.entity';

const router = Router();
router.use(authenticate, resolveTenant, checkModule('expenses'));

const expenseRepo = () => AppDataSource.getRepository(Expense);
const subRepo = () => AppDataSource.getRepository(TenantSubscription);


// Helper interno rápido para extraer nombres de empleados de forma segura
async function getUserName(req: Request): Promise<string> {
  let name = (req.user as any)?.name;
  if (!name) {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.user!.sub } });
    name = user ? user.name : 'Personal de Caja';
  }
  return name;
}

// Verifica límite mensual según plan
async function checkMonthlyLimit(tenantId: string, maxAllowed: number): Promise<boolean> {
  if (maxAllowed === -1) return true; // ilimitado
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  const count = await expenseRepo().count({
    where: { tenantId, date: Between(start, end) },
  });
  return count < maxAllowed;
}

// GET /api/expenses
router.get('/', async (req: Request, res: Response) => {
  const { month, year, category, page = 1, limit = 20 } = req.query;
  const tenantId = req.tenant!.id;
  const where: any = { tenantId };

  if (month && year) {
    const m = String(month).padStart(2, '0');
    const start = `${year}-${m}-01`;
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    const end = `${year}-${m}-${lastDay}`;
    where.date = Between(start, end);
  }
  if (category) where.category = category;

  const [items, total] = await expenseRepo().findAndCount({
    where,
    order: { date: 'DESC', createdAt: 'DESC' },
    take: Number(limit),
    skip: (Number(page) - 1) * Number(limit),
    relations: ['createdBy', 'supplier'],
  });

  // Suma total del período
  const sum = items.reduce((acc, e) => acc + Number(e.amount), 0);

  res.json({ items, total, sum, page: Number(page), limit: Number(limit) });
});

// GET /api/expenses/months - Obtener meses con gastos registrados
router.get('/months', async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  
  try {
    const result = await expenseRepo()
      .createQueryBuilder('expense')
      .select('DISTINCT EXTRACT(MONTH FROM expense.date)', 'month')
      .addSelect('EXTRACT(YEAR FROM expense.date)', 'year')
      .where('expense.tenantId = :tenantId', { tenantId })
      .orderBy('year', 'DESC')
      .addOrderBy('month', 'DESC')
      .getRawMany();
    
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: 'Error al obtener meses con gastos' });
  }
});

// POST /api/expenses
router.post('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;

  const sub = await subRepo().findOne({
    where: { tenantId, status: SubscriptionStatus.ACTIVE },
    relations: ['plan'],
    order: { createdAt: 'DESC' },
  });
  const maxExpenses = sub?.plan?.maxExpensesPerMonth ?? 50;

  const canAdd = await checkMonthlyLimit(tenantId, maxExpenses);
  if (!canAdd) {
    res.status(403).json({
      message: `Has alcanzado el límite de ${maxExpenses} gastos este mes.`,
      code: 'EXPENSE_LIMIT_REACHED',
      upgradeRequired: true,
    });
    return;
  }

  try {
    const expense = expenseRepo().create({
      ...req.body,
      tenantId,
      createdById: req.user!.sub,
    });
    const saved = await expenseRepo().save(expense);

    // 📝 LOG: Casteo a 'any' para evitar error 'Property does not exist on type Expense[]'
    const s = saved as any;
    const operatorName = await getUserName(req);
    await logAction({
      tenantId,
      userId: req.user!.sub,
      userName: operatorName,
      action: AuditAction.CREATE,
      module: 'expenses',
      description: `Registró un nuevo gasto: "${s.description}" por valor de $${Number(s.amount).toLocaleString('es-CO')}.`
    });

    res.status(201).json(saved);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// PATCH /api/expenses/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const expense = await expenseRepo().findOne({
    where: { id: req.params.id, tenantId: req.tenant!.id },
  });
  if (!expense) { res.status(404).json({ message: 'Gasto no encontrado.' }); return; }

  // Detectar cambios antes de sobreescribir el registro original
  const updates = req.body;
  const cambios: string[] = [];
  if (updates.description && updates.description !== expense.description) {
    cambios.push(`descripción a "${updates.description}"`);
  }
  if (updates.amount !== undefined && Number(updates.amount) !== Number(expense.amount)) {
    cambios.push(`monto de $${Number(expense.amount).toLocaleString('es-CO')} a $${Number(updates.amount).toLocaleString('es-CO')}`);
  }

  Object.assign(expense, updates);
  const saved = await expenseRepo().save(expense);

  // 📝 LOG: Registro de Auditoría de Modificación
  if (cambios.length > 0) {
    const operatorName = await getUserName(req);
    await logAction({
      tenantId: req.tenant!.id,
      userId: req.user!.sub,
      userName: operatorName,
      action: AuditAction.UPDATE,
      module: 'expenses',
      description: `Modificó el gasto "${saved.description}": Cambió ${cambios.join(', ')}.`
    });
  }

  res.json(saved);
});

// DELETE /api/expenses/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const expense = await expenseRepo().findOne({
    where: { id: req.params.id, tenantId: req.tenant!.id },
  });
  if (!expense) { res.status(404).json({ message: 'Gasto no encontrado.' }); return; }

  await expenseRepo().delete({ id: req.params.id, tenantId: req.tenant!.id });

  // 📝 LOG: Registro de Auditoría de Eliminación
  const operatorName = await getUserName(req);
  await logAction({
    tenantId: req.tenant!.id,
    userId: req.user!.sub,
    userName: operatorName,
    action: AuditAction.DELETE,
    module: 'expenses',
    description: `Eliminó permanentemente el registro de gasto: "${expense.description}" ($${Number(expense.amount).toLocaleString('es-CO')}).`
  });

  res.json({ message: 'Gasto eliminado.' });
});

export default router;
