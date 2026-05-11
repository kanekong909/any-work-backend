import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { Plan } from './plan.entity';
import { TenantSubscription, SubscriptionStatus, PaymentMethod } from './tenant-subscription.entity';
import { authenticate, adminOrAbove } from '../../shared/middleware/auth.middleware'; // 👈 Asegúrate de importar tu middleware de admin
import { resolveTenant } from '../../shared/middleware/tenant.middleware';
import { logAction } from '../../shared/utils/audit'; // 👈 Importamos el helper de auditoría
import { AuditAction } from '../audit/audit-log.entity';

const router = Router();
router.use(authenticate);

const planRepo = () => AppDataSource.getRepository(Plan);
const subRepo = () => AppDataSource.getRepository(TenantSubscription);

// GET /api/plans — todos los planes disponibles
router.get('/', async (_req: Request, res: Response) => {
  const plans = await planRepo().find({ where: { isActive: true }, order: { priceMonthly: 'ASC' } });
  res.json(plans);
});

// GET /api/plans/my-subscription — suscripción actual
router.get('/my-subscription', resolveTenant, async (req: Request, res: Response) => {
  const sub = await subRepo().findOne({
    where: { tenantId: req.tenant!.id, status: SubscriptionStatus.ACTIVE },
    relations: ['plan'],
    order: { createdAt: 'DESC' },
  });
  res.json(sub);
});

// POST /api/plans/request-upgrade — cliente solicita upgrade
router.post('/request-upgrade', resolveTenant, async (req: Request, res: Response) => {
  const { planId, paymentMethod, amountPaid, notes } = req.body;

  const plan = await planRepo().findOne({ where: { id: planId } });
  if (!plan) { res.status(404).json({ message: 'Plan no encontrado.' }); return; }

  // Crear suscripción pendiente de verificación
  const sub = subRepo().create({
    tenantId: req.tenant!.id,
    planId,
    status: SubscriptionStatus.PENDING_PAYMENT,
    paymentMethod: paymentMethod || PaymentMethod.NEQUI,
    amountPaid: amountPaid || 0,
    // El admin la activará manualmente
  });

  const saved = await subRepo().save(sub);
  res.status(201).json({
    message: '¡Solicitud de upgrade enviada! El administrador la verificará y activará tu plan.',
    subscription: saved,
    paymentInfo: {
      nequi: process.env.NEQUI_NUMBER,
      bank: process.env.BANK_ACCOUNT_INFO,
      whatsapp: process.env.WHATSAPP_SUPPORT,
    },
  });
});

// PATCH /api/plans/activate/:id — El administrador aprueba el pago y activa el plan
router.patch('/activate/:id', adminOrAbove, async (req: Request, res: Response) => {
  try {
    const subscription = await subRepo().findOne({
      where: { id: req.params.id },
      relations: ['plan']
    });

    if (!subscription) {
      res.status(404).json({ message: 'Solicitud de suscripción no encontrada.' });
      return;
    }

    // 1. Cambiar el estado de la suscripción anterior a cancelada/expirada si existía
    await subRepo().update(
      { tenantId: subscription.tenantId, status: SubscriptionStatus.ACTIVE },
      { status: SubscriptionStatus.CANCELLED }
    );

    // 2. Activar la nueva suscripción y definir los tiempos
    subscription.status = SubscriptionStatus.ACTIVE;
    subscription.activatedAt = new Date();
    subscription.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 días de vigencia
    subscription.activatedById = req.user!.sub;

    const saved = await subRepo().save(subscription);

    // 📝 3. LOG DE AUDITORÍA: Guardamos la traza para el historial del cliente
    await logAction({
      tenantId: saved.tenantId,
      userId: null, // Lo realiza el administrador del sistema
      userName: 'Sistema NexoAdmin',
      action: AuditAction.UPDATE,
      module: 'auth',
      description: `¡Suscripción aprobada! Tu negocio ha ascendido exitosamente al plan "${(saved.plan as any).displayName}". Límite de usuarios y herramientas ampliado.`
    });

    res.json({ message: 'Suscripción activada con éxito.', subscription: saved });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
