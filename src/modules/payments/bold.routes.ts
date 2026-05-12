import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { TenantSubscription, SubscriptionStatus, PaymentMethod } from '../plans/tenant-subscription.entity';
import { Tenant, TenantStatus } from '../tenants/tenant.entity';
import { Plan } from '../plans/plan.entity';
import crypto from 'crypto';

const router = Router();

// GET /api/payments/bold/links?tenantId=&planId=
router.get('/bold/links', async (req: Request, res: Response) => {
  const { tenantId, planId } = req.query;
  if (!tenantId || !planId) {
    res.status(400).json({ message: 'tenantId y planId son requeridos.' });
    return;
  }

  const planRepo = AppDataSource.getRepository(Plan);
  const subRepo = AppDataSource.getRepository(TenantSubscription);

  const plan = await planRepo.findOne({ where: { id: planId as string } });
  if (!plan) { res.status(404).json({ message: 'Plan no encontrado.' }); return; }

  // Cancelar pendientes anteriores del mismo tenant
  await subRepo.update(
    { tenantId: tenantId as string, status: SubscriptionStatus.PENDING_PAYMENT },
    { status: SubscriptionStatus.CANCELLED }
  );

  // Crear nueva suscripción pendiente
  const sub = subRepo.create({
    tenantId: tenantId as string,
    planId: planId as string,
    status: SubscriptionStatus.PENDING_PAYMENT,
    paymentMethod: PaymentMethod.BOLD,
    amountPaid: 0,
  });
  await subRepo.save(sub);

  // Link estático según el plan
  const links: Record<string, string> = {
    pro: process.env.BOLD_LINK_PRO || '',
    business: process.env.BOLD_LINK_BUSINESS || '',
  };

  const link = links[plan.name];
  if (!link) {
    res.status(404).json({ message: 'Link de pago no configurado para este plan.' });
    return;
  }

  res.json({ link, plan: plan.displayName, amount: plan.priceMonthly });
});

// POST /api/payments/bold/webhook
router.post('/bold/webhook', async (req: Request, res: Response) => {
  try {
    const event = req.body;
    console.log('Bold webhook recibido:', JSON.stringify(event, null, 2));

    // Verificar firma si existe
    const signature = req.headers['x-bold-signature'] as string;
    if (process.env.BOLD_WEBHOOK_SECRET && signature) {
      const rawBody = JSON.stringify(event);
      const hmac = crypto.createHmac('sha256', process.env.BOLD_WEBHOOK_SECRET)
        .update(rawBody).digest('hex');
      if (hmac !== signature) {
        res.status(401).json({ message: 'Firma inválida.' });
        return;
      }
    }

    // Solo procesar ventas aprobadas
    const status = event.status || event.transaction?.status || event.payment?.status;
    if (!['APPROVED', 'COMPLETED', 'ACCEPTED'].includes(status?.toUpperCase())) {
      console.log('Evento ignorado, status:', status);
      res.json({ received: true });
      return;
    }

    // Obtener email del comprador para identificar al tenant
    const buyerEmail = event.customer?.email
      || event.payer?.email
      || event.buyer?.email
      || event.email
      || '';

    console.log('Email del comprador:', buyerEmail);

    const subRepo = AppDataSource.getRepository(TenantSubscription);
    const tenantRepo = AppDataSource.getRepository(Tenant);

    let pendingSub = null;

    // Intentar encontrar por email del usuario
    if (buyerEmail) {
      const userRepo = AppDataSource.getRepository('users');
      const user = await AppDataSource.query(
        `SELECT "tenantId" FROM users WHERE email = $1 LIMIT 1`,
        [buyerEmail.toLowerCase()]
      );

      if (user.length > 0) {
        const tenantId = user[0].tenantId;
        pendingSub = await subRepo.findOne({
          where: { tenantId, status: SubscriptionStatus.PENDING_PAYMENT },
          relations: ['plan'],
          order: { createdAt: 'DESC' },
        });
      }
    }

    // Si no encontró por email, tomar la más reciente pendiente
    if (!pendingSub) {
      pendingSub = await subRepo.findOne({
        where: { status: SubscriptionStatus.PENDING_PAYMENT },
        relations: ['plan'],
        order: { createdAt: 'DESC' },
      });
    }

    if (!pendingSub) {
      console.log('No hay suscripción pendiente para activar.');
      res.json({ received: true });
      return;
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Activar suscripción
    await subRepo.update(pendingSub.id, {
      status: SubscriptionStatus.ACTIVE,
      activatedAt: new Date(),
      expiresAt,
      amountPaid: pendingSub.plan.priceMonthly,
    });

    // Activar tenant con módulos del plan
    await tenantRepo.update(pendingSub.tenantId, {
      status: TenantStatus.ACTIVE,
      activatedAt: new Date(),
      enabledModules: pendingSub.plan.features,
    });

    console.log(`✅ Plan ${pendingSub.plan.displayName} activado para tenant ${pendingSub.tenantId}`);
    res.json({ received: true });

  } catch (err: any) {
    console.error('Error procesando webhook Bold:', err);
    res.status(500).json({ message: 'Error interno.' });
  }
});

export default router;