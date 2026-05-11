import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { AuditLog } from './audit-log.entity';
import { authenticate, adminOrAbove } from '../../shared/middleware/auth.middleware';
import { resolveTenant } from '../../shared/middleware/tenant.middleware';
import { Between, ILike } from 'typeorm';

const router = Router();

// 🔒 Protegemos todas las rutas de este archivo
router.use(authenticate, resolveTenant);

// GET /api/audit — Listar el historial de movimientos del negocio con paginación y filtros
router.get('/', adminOrAbove, async (req: Request, res: Response) => {
  try {
    const logRepo = AppDataSource.getRepository(AuditLog);
    
    // Parámetros de paginación
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    
    // Filtros
    const module = req.query.module as string;
    const action = req.query.action as string;
    const search = req.query.search as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    
    // Construir condiciones WHERE
    let whereConditions: any = { tenantId: req.tenant!.id };
    
    // Filtro por módulo
    if (module) {
      whereConditions.module = module;
    }
    
    // Filtro por acción
    if (action) {
      whereConditions.action = action;
    }
    
    // Filtro por búsqueda (userName o description)
    if (search && search.trim()) {
      whereConditions = [
        { ...whereConditions, userName: ILike(`%${search}%`) },
        { ...whereConditions, description: ILike(`%${search}%`) }
      ];
    }
    
    // Filtro por rango de fechas
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      whereConditions.createdAt = Between(start, end);
    } else if (startDate) {
      const start = new Date(startDate);
      const end = new Date(startDate);
      end.setHours(23, 59, 59, 999);
      whereConditions.createdAt = Between(start, end);
    } else if (endDate) {
      const start = new Date(endDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      whereConditions.createdAt = Between(start, end);
    }
    
    // Ejecutar consulta con paginación
    const [items, total] = await logRepo.findAndCount({
      where: whereConditions,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: skip
    });
    
    res.json({
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error al obtener logs:', error);
    res.status(500).json({ message: 'Error interno al cargar el historial.' });
  }
});

export default router;