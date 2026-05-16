import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { Customer } from './customer.entity';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { resolveTenant } from '../../shared/middleware/tenant.middleware';
import { ILike } from 'typeorm';
import { Plan } from '../plans/plan.entity';
import { checkLimit } from '../../shared/utils/plan.utils';
import { logAction } from '../../shared/utils/audit';
import { AuditAction } from '../audit/audit-log.entity';
import { User } from '../users/user.entity';

const router = Router();
router.use(authenticate, resolveTenant);

const repo = () => AppDataSource.getRepository(Customer);

// Helper interno para resolver nombres de empleados de forma segura
async function getUserName(req: Request): Promise<string> {
  let name = (req.user as any)?.name;

  if (!name) {
    const user = await AppDataSource
      .getRepository(User)
      .findOne({
        where: { id: req.user!.sub }
      });

    name = user ? user.name : 'Personal de Clientes';
  }

  return name;
}

router.get('/', async (req: Request, res: Response) => {
  const { search, page = 1, limit = 20 } = req.query;
  const where: any = { tenantId: req.tenant!.id, isActive: true };
  if (search) where.name = ILike(`%${search}%`);
  const [items, total] = await repo().findAndCount({
    where, order: { name: 'ASC' },
    take: Number(limit), skip: (Number(page) - 1) * Number(limit),
  });
  res.json({ items, total });
});

// POST /api/customers
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;

    // 1. Contar clientes activos
    const currentCount = await repo().count({
      where: { tenantId, isActive: true }
    });

    // 2. Validar límite del plan
    const check = await checkLimit(
      tenantId,
      'maxCustomers' as any as keyof Plan,
      currentCount
    );

    if (!check.allowed) {
      res.status(403).json({
        message: `Tu plan permite máximo ${check.limit} clientes activos. Actualiza tu plan para agregar más.`,
        code: 'CUSTOMER_LIMIT_REACHED',
        upgradeRequired: true,
      });
      return;
    }

    // 3. Crear cliente
    const customer = repo().create({
      ...req.body,
      tenantId
    });

    const saved = await repo().save(customer);

    // 📝 AUDITORÍA
    const s = saved as any;

    const operatorName = await getUserName(req);

    await logAction({
      tenantId,
      userId: req.user!.sub,
      userName: operatorName || 'Usuario Desconocido',
      action: AuditAction.CREATE,
      module: 'customers',
      description: `Creó el cliente "${s.name}"${s.phone ? ` con teléfono ${s.phone}` : ''}.`
    });

    // 4. Respuesta
    res.status(201).json(saved);

  } catch (err: any) {
    res.status(400).json({
      message: err.message
    });
  }
});

// PATCH /api/customers/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const customer = await repo().findOne({
    where: {
      id: req.params.id,
      tenantId: req.tenant!.id
    }
  });

  if (!customer) {
    res.status(404).json({
      message: 'Cliente no encontrado.'
    });
    return;
  }

  const updates = { ...req.body };

  // Detectar cambios
  const cambios: string[] = [];

  if (updates.name && updates.name !== customer.name) {
    cambios.push(`nombre a "${updates.name}"`);
  }

  if (updates.phone && updates.phone !== customer.phone) {
    cambios.push(`teléfono a "${updates.phone}"`);
  }

  if (updates.email && updates.email !== customer.email) {
    cambios.push(`correo a "${updates.email}"`);
  }

  if (
    updates.address &&
    updates.address !== customer.address
  ) {
    cambios.push(`dirección`);
  }

  if (
    updates.isActive !== undefined &&
    updates.isActive !== customer.isActive
  ) {
    cambios.push(
      updates.isActive
        ? 'activó el cliente'
        : 'desactivó el cliente'
    );
  }

  // Aplicar cambios
  Object.assign(customer, updates);

  const saved = await repo().save(customer);

  // 📝 AUDITORÍA
  if (cambios.length > 0) {
    const operatorName = await getUserName(req);

    await logAction({
      tenantId: req.tenant!.id,
      userId: req.user!.sub,
      userName: operatorName || 'Usuario Desconocido',
      action: AuditAction.UPDATE,
      module: 'customers',
      description: `Actualizó el cliente "${saved.name}": ${cambios.join(', ')}.`
    });
  }

  res.json(saved);
});

// DELETE /api/customers/:id
router.delete('/:id', async (req: Request, res: Response) => {

  const customer = await repo().findOne({
    where: {
      id: req.params.id,
      tenantId: req.tenant!.id
    }
  });

  if (!customer) {
    res.status(404).json({
      message: 'Cliente no encontrado.'
    });
    return;
  }

  // Soft delete
  customer.isActive = false;

  await repo().save(customer);

  // 📝 AUDITORÍA
  const operatorName = await getUserName(req);

  await logAction({
    tenantId: req.tenant!.id,
    userId: req.user!.sub,
    userName: operatorName || 'Usuario Desconocido',
    action: AuditAction.DELETE,
    module: 'customers',
    description: `Desactivó el cliente "${customer.name}".`
  });

  res.json({
    message: 'Cliente eliminado.'
  });
});

export default router;