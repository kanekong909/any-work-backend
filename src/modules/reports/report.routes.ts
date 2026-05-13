import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { Sale, SaleStatus } from '../sales/sale.entity';
import { Expense } from '../expenses/expense.entity';
import { Product } from '../products/product.entity';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { resolveTenant } from '../../shared/middleware/tenant.middleware';
import { Between } from 'typeorm';
import { getActivePlan } from '../../shared/utils/plan.utils';

const router = Router();
router.use(authenticate, resolveTenant);

const saleRepo = () => AppDataSource.getRepository(Sale);
const expenseRepo = () => AppDataSource.getRepository(Expense);
const productRepo = () => AppDataSource.getRepository(Product);

// GET /api/reports/summary?from=2024-01-01&to=2024-12-31
router.get('/summary', async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const { from, to } = req.query as { from: string; to: string };

  const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const toDate = to ? new Date(to) : new Date();
  toDate.setHours(23, 59, 59);

  const [sales, expenses] = await Promise.all([
    saleRepo().find({ where: { tenantId, createdAt: Between(fromDate, toDate) }, relations: ['items'] }),
    expenseRepo().find({ where: { tenantId, date: Between(
      fromDate.toISOString().split('T')[0],
      toDate.toISOString().split('T')[0]
    ) } }),
  ]);

  const totalRevenue = sales.reduce((a, s) => a + Number(s.total), 0);
  const totalExpenses = expenses.reduce((a, e) => a + Number(e.amount), 0);
  const totalCost = sales.reduce((a, s) =>
    a + s.items.reduce((b, i) => b + (Number(i.quantity) * 0), 0), 0);

  // Ventas por día
  const salesByDay: Record<string, number> = {};
  sales.forEach(s => {
    const day = s.createdAt.toISOString().split('T')[0];
    salesByDay[day] = (salesByDay[day] || 0) + Number(s.total);
  });

  // Gastos por categoría
  const expensesByCategory: Record<string, number> = {};
  expenses.forEach(e => {
    expensesByCategory[e.category] = (expensesByCategory[e.category] || 0) + Number(e.amount);
  });

  // Top productos vendidos
  const productMap: Record<string, { name: string; qty: number; revenue: number }> = {};
  sales.forEach(s => s.items.forEach(i => {
    if (!productMap[i.productId]) productMap[i.productId] = { name: i.productName, qty: 0, revenue: 0 };
    productMap[i.productId].qty += Number(i.quantity);
    productMap[i.productId].revenue += Number(i.subtotal);
  }));
  const topProducts = Object.values(productMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Al final de GET /summary, antes del res.json agrega:
  const prevMonthStart = new Date(fromDate.getFullYear(), fromDate.getMonth() - 1, 1);
  const prevMonthEnd = new Date(fromDate.getFullYear(), fromDate.getMonth(), 0, 23, 59, 59);

  const prevSales = await saleRepo().find({
    where: { tenantId, status: SaleStatus.COMPLETED, createdAt: Between(prevMonthStart, prevMonthEnd) },
    select: ['total'],
  });
  const prevExpenses = await expenseRepo().find({
    where: { tenantId, date: Between(
      prevMonthStart.toISOString().split('T')[0],
      prevMonthEnd.toISOString().split('T')[0]
    )},
    select: ['amount'],
  });

  const prevRevenue = prevSales.reduce((a, s) => a + Number(s.total), 0);
  const prevExpensesTotal = prevExpenses.reduce((a, e) => a + Number(e.amount), 0);

  res.json({
    totalRevenue,
    totalExpenses,
    salesCount: sales.length,
    salesByDay,
    expensesByCategory,
    topProducts,
    revenue: prevRevenue,
    expenses: prevExpensesTotal,
    profit: prevRevenue - prevExpensesTotal,
  });
});

// GET /api/reports/sales-detail?from=&to=
router.get('/sales-detail', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;

    // 1. Validar si el plan activo permite el acceso a reportes detallados
    const plan = await getActivePlan(tenantId);
    if (!plan || plan.name === 'free') {
      res.status(403).json({
        message: 'Exportar reportes detallados está disponible desde el plan Pro.',
        code: 'FEATURE_NOT_AVAILABLE',
        upgradeRequired: true,
      });
      return;
    }

    // 2. Procesar filtros de fechas si la validación es exitosa
    const { from, to } = req.query as { from: string; to: string };
    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const toDate = to ? new Date(to) : new Date();
    toDate.setHours(23, 59, 59);

    // 3. Consultar y retornar la información detallada de ventas
    const sales = await AppDataSource.getRepository(Sale).find({
      where: { tenantId, createdAt: Between(fromDate, toDate) },
      relations: ['items'],
      order: { createdAt: 'DESC' },
    });

    res.json(sales);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

export default router;