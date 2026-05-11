import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { Tenant, TenantStatus } from '../tenants/tenant.entity';
import { TenantSubscription, SubscriptionStatus } from '../plans/tenant-subscription.entity';
import { Plan } from '../plans/plan.entity';
import { User, UserRole } from '../users/user.entity';
import { authenticate, superadminOnly } from '../../shared/middleware/auth.middleware';

const router = Router();
router.use(authenticate, superadminOnly); // Solo tú

const tenantRepo = () => AppDataSource.getRepository(Tenant);
const subRepo = () => AppDataSource.getRepository(TenantSubscription);
const planRepo = () => AppDataSource.getRepository(Plan);
const userRepo = () => AppDataSource.getRepository(User);

// ── Dashboard admin ────────────────────────────────────────────

// GET /api/admin/stats
router.get('/stats', async (_req: Request, res: Response) => {
  const [totalTenants, activeTenants, pendingTenants, totalUsers] = await Promise.all([
    tenantRepo().count(),
    tenantRepo().count({ where: { status: TenantStatus.ACTIVE } }),
    tenantRepo().count({ where: { status: TenantStatus.PENDING } }),
    userRepo().count({ where: { role: UserRole.ADMIN } }),
  ]);

  const pendingPayments = await subRepo().count({
    where: { status: SubscriptionStatus.PENDING_PAYMENT },
  });

  res.json({ totalTenants, activeTenants, pendingTenants, totalUsers, pendingPayments });
});

// ── Gestión de tenants ─────────────────────────────────────────

// GET /api/admin/tenants
router.get('/tenants', async (req: Request, res: Response) => {
  const { status, page = 1, limit = 20 } = req.query;
  const where: any = {};
  if (status) where.status = status;

  const [items, total] = await tenantRepo().findAndCount({
    where,
    order: { createdAt: 'DESC' },
    take: Number(limit),
    skip: (Number(page) - 1) * Number(limit),
    relations: ['users', 'subscriptions', 'subscriptions.plan'],
  });

  res.json({ items, total });
});

// PATCH /api/admin/tenants/:id/status — cambiar estado del tenant
router.patch('/tenants/:id/status', async (req: Request, res: Response) => {
  const { status } = req.body;
  await tenantRepo().update(req.params.id, {
    status,
    ...(status === TenantStatus.ACTIVE ? { activatedAt: new Date() } : {}),
    ...(status === TenantStatus.SUSPENDED ? { suspendedAt: new Date() } : {}),
  });
  res.json({ message: `Tenant actualizado a: ${status}` });
});

// ── Gestión de suscripciones / pagos ──────────────────────────

// GET /api/admin/subscriptions/pending
router.get('/subscriptions/pending', async (_req: Request, res: Response) => {
  const pending = await subRepo().find({
    where: { status: SubscriptionStatus.PENDING_PAYMENT },
    relations: ['tenant', 'plan'],
    order: { createdAt: 'ASC' },
  });
  res.json(pending);
});

// POST /api/admin/subscriptions/:id/activate — activar plan tras verificar pago
router.post('/subscriptions/:id/activate', async (req: Request, res: Response) => {
  const sub = await subRepo().findOne({
    where: { id: req.params.id },
    relations: ['tenant', 'plan'],
  });
  if (!sub) { res.status(404).json({ message: 'Suscripción no encontrada.' }); return; }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 días

  // Activar suscripción
  await subRepo().update(sub.id, {
    status: SubscriptionStatus.ACTIVE,
    activatedAt: new Date(),
    expiresAt,
    activatedById: req.user!.sub,
    adminNotes: req.body.notes,
  });

  // Actualizar tenant: activar + habilitar módulos del plan
  await tenantRepo().update(sub.tenantId, {
    status: TenantStatus.ACTIVE,
    activatedAt: new Date(),
    enabledModules: sub.plan.features,
  });

  res.json({ message: `Plan "${sub.plan.displayName}" activado para ${sub.tenant.businessName}.` });
});

// POST /api/admin/subscriptions/:id/reject — rechazar pago
router.post('/subscriptions/:id/reject', async (req: Request, res: Response) => {
  await subRepo().update(req.params.id, {
    status: SubscriptionStatus.CANCELLED,
    adminNotes: req.body.reason,
  });
  res.json({ message: 'Suscripción rechazada.' });
});

// ── Planes ─────────────────────────────────────────────────────

// POST /api/admin/plans — crear plan
router.post('/plans', async (req: Request, res: Response) => {
  const plan = planRepo().create(req.body);
  const saved = await planRepo().save(plan);
  res.status(201).json(saved);
});

// PATCH /api/admin/plans/:id
router.patch('/plans/:id', async (req: Request, res: Response) => {
  await planRepo().update(req.params.id, req.body);
  res.json({ message: 'Plan actualizado.' });
});

export default router;
