import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { AuditLog } from './audit-log.entity';
import { authenticate, adminOrAbove } from '../../shared/middleware/auth.middleware';
import { resolveTenant } from '../../shared/middleware/tenant.middleware';

const router = Router();

// 🔒 Protegemos todas las rutas de este archivo
router.use(authenticate, resolveTenant);

// GET /api/audit — Listar el historial de movimientos del negocio
router.get('/', adminOrAbove, async (req: Request, res: Response) => {
  try {
    const logRepo = AppDataSource.getRepository(AuditLog);
    
    const logs = await logRepo.find({
      where: { tenantId: req.tenant!.id },
      order: { createdAt: 'DESC' }, // Los más recientes primero
      take: 100 // Limitamos a los últimos 100 para optimizar rendimiento
    });

    res.json(logs);
  } catch (error) {
    console.error('Error al obtener logs:', error);
    res.status(500).json({ message: 'Error interno al cargar el historial.' });
  }
});

export default router;
