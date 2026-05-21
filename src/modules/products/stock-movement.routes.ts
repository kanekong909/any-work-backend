import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { StockMovement, MovementReason, MovementType } from './stock.movement';
import { Product } from './product.entity';
import { User } from '../users/user.entity';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { resolveTenant, checkModule } from '../../shared/middleware/tenant.middleware';
import { logAction } from '../../shared/utils/audit';
import { AuditAction } from '../audit/audit-log.entity';
import { StockMovementService } from './stock-movement.service';
import { Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';

const router = Router();
router.use(authenticate, resolveTenant, checkModule('inventory'));

const movementRepo = () => AppDataSource.getRepository(StockMovement);
const productRepo = () => AppDataSource.getRepository(Product);

async function getUserName(req: Request): Promise<string> {
  let name = (req.user as any)?.name;
  if (!name) {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.user!.sub } });
    name = user ? user.name : 'Personal de Inventario';
  }
  return name;
}

// GET /api/stock-movements - Historial con filtros y paginación
router.get('/', async (req: Request, res: Response) => {
  try {
    const { productId, reason, type, page = 1, limit = 20, startDate, endDate } = req.query;
    const tenantId = req.tenant!.id;

    const where: any = { tenantId };
    if (productId) where.productId = productId;
    if (reason) where.reason = reason;
    if (type) where.movementType = type;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[MoreThanOrEqual] = new Date(startDate as string);
      if (endDate) where.createdAt[LessThanOrEqual] = new Date(endDate as string);
    }

    const [items, total] = await movementRepo().findAndCount({
      where,
      relations: ['product', 'user', 'warehouse'],
      order: { createdAt: 'DESC' },
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit),
    });

    res.json({
      items,
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// GET /api/stock-movements/product/:productId - Historial completo de un producto
router.get('/product/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const tenantId = req.tenant!.id;

    const product = await productRepo().findOne({
      where: { id: productId, tenantId }
    });

    if (!product) {
      res.status(404).json({ message: 'Producto no encontrado' });
      return;
    }

    const [movements, total] = await movementRepo().findAndCount({
      where: { productId, tenantId },
      relations: ['user', 'warehouse'],
      order: { createdAt: 'DESC' },
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit),
    });

    res.json({
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        currentStock: product.stock,
      },
      movements,
      total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// GET /api/stock-movements/report/by-reason - Agregados por razón
router.get('/report/by-reason', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const tenantId = req.tenant!.id;

    const where: any = { tenantId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[MoreThanOrEqual] = new Date(startDate as string);
      if (endDate) where.createdAt[LessThanOrEqual] = new Date(endDate as string);
    }

    const movements = await movementRepo().find({
      where,
      relations: ['product'],
    });

    const report: any = {};

    Object.values(MovementReason).forEach(reason => {
      report[reason] = {
        count: 0,
        totalQuantity: 0,
        totalValue: 0,
      };
    });

    movements.forEach(m => {
      const entry = report[m.reason];
      if (entry) {
        entry.count += 1;
        const qty = m.movementType === MovementType.OUT ? -Number(m.quantity) : Number(m.quantity);
        entry.totalQuantity += qty;
        if (m.unitCost) {
          entry.totalValue += qty * Number(m.unitCost);
        }
      }
    });

    res.json(report);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// GET /api/stock-movements/report/by-type - Agregados por tipo
router.get('/report/by-type', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const tenantId = req.tenant!.id;

    const where: any = { tenantId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[MoreThanOrEqual] = new Date(startDate as string);
      if (endDate) where.createdAt[LessThanOrEqual] = new Date(endDate as string);
    }

    const movements = await movementRepo().find({
      where,
    });

    const report: any = {
      IN: { count: 0, totalQuantity: 0, totalValue: 0 },
      OUT: { count: 0, totalQuantity: 0, totalValue: 0 },
      ADJUSTMENT: { count: 0, totalQuantity: 0, totalValue: 0 },
    };

    movements.forEach(m => {
      const entry = report[m.movementType];
      if (entry) {
        entry.count += 1;
        const qty = m.movementType === MovementType.OUT ? -Number(m.quantity) : Number(m.quantity);
        entry.totalQuantity += qty;
        if (m.unitCost) {
          entry.totalValue += qty * Number(m.unitCost);
        }
      }
    });

    res.json(report);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// POST /api/stock-movements - Crear movimiento manual (ajuste)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { productId, quantity, reason, notes, warehouseId } = req.body;
    const tenantId = req.tenant!.id;
    const userId = req.user!.sub;

    if (!productId || !quantity || !reason) {
      res.status(400).json({ message: 'productId, quantity y reason son requeridos' });
      return;
    }

    if (!Object.values(MovementReason).includes(reason)) {
      res.status(400).json({ message: 'Razón de movimiento inválida' });
      return;
    }

    const movement = await StockMovementService.recordAdjustmentMovement(
      productId,
      Number(quantity),
      tenantId,
      reason,
      userId,
      warehouseId,
      notes
    );

    const operatorName = await getUserName(req);
    await logAction({
      tenantId,
      userId,
      userName: operatorName,
      action: AuditAction.CREATE,
      module: 'inventory',
      description: `Registró ajuste de inventario: ${movement.product?.name} ${quantity} unidades (Razón: ${reason})`,
    });

    res.status(201).json(movement);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
