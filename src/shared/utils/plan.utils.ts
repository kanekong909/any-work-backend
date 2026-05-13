import { AppDataSource } from '../../config/data-source';
import { TenantSubscription, SubscriptionStatus } from '../../modules/plans/tenant-subscription.entity';
import { Plan } from '../../modules/plans/plan.entity';

export async function getActivePlan(tenantId: string): Promise<Plan | null> {
  const subRepo = AppDataSource.getRepository(TenantSubscription);
  const sub = await subRepo.findOne({
    where: { tenantId, status: SubscriptionStatus.ACTIVE },
    relations: ['plan'],
    order: { createdAt: 'DESC' },
  });
  return sub?.plan || null;
}

export async function checkLimit(
  tenantId: string,
  limitKey: keyof Plan,
  currentCount: number
): Promise<{ allowed: boolean; limit: number; current: number }> {
  const plan = await getActivePlan(tenantId);
  const limit = plan ? Number((plan as any)[limitKey]) : 0;
  if (limit === -1) return { allowed: true, limit: -1, current: currentCount };
  return { allowed: currentCount < limit, limit, current: currentCount };
}