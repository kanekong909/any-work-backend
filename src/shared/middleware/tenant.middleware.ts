import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../../config/data-source';
import { Tenant, TenantStatus } from '../../modules/tenants/tenant.entity';

declare global {
  namespace Express {
    interface Request {
      tenant?: Tenant;
    }
  }
}

/**
 * Adjunta el tenant activo al request.
 * Úsalo después de `authenticate` en rutas que requieren contexto de negocio.
 */
export const resolveTenant = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // El superadmin no necesita tenant
  if (req.user?.role === 'superadmin') {
    return next();
  }

  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    res.status(403).json({ message: 'No perteneces a ningún negocio.' });
    return;
  }

  const tenantRepo = AppDataSource.getRepository(Tenant);
  const tenant = await tenantRepo.findOne({ where: { id: tenantId } });

  if (!tenant) {
    res.status(404).json({ message: 'Negocio no encontrado.' });
    return;
  }

  if (tenant.status === TenantStatus.SUSPENDED) {
    res.status(403).json({
      message: 'Tu suscripción está suspendida. Contacta a soporte para reactivarla.',
      code: 'SUBSCRIPTION_SUSPENDED',
    });
    return;
  }

  if (tenant.status === TenantStatus.PENDING) {
    res.status(403).json({
      message: 'Tu cuenta está pendiente de activación. Completa el pago para continuar.',
      code: 'ACCOUNT_PENDING',
    });
    return;
  }

  req.tenant = tenant;
  next();
};

/**
 * Verifica que el tenant tenga un módulo habilitado.
 * Uso: checkModule('expenses')
 */
export const checkModule = (moduleName: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user?.role === 'superadmin') return next();

    const enabled = req.tenant?.enabledModules?.[moduleName];
    if (!enabled) {
      res.status(403).json({
        message: `El módulo "${moduleName}" no está disponible en tu plan actual.`,
        code: 'MODULE_NOT_AVAILABLE',
        upgradeRequired: true,
      });
      return;
    }
    next();
  };
};
