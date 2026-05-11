import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../../config/data-source';
import { User, UserRole } from './user.entity';
import { authenticate, adminOrAbove } from '../../shared/middleware/auth.middleware';
import { resolveTenant } from '../../shared/middleware/tenant.middleware';
import { SubscriptionStatus, TenantSubscription } from '../plans/tenant-subscription.entity';
import { logAction } from '../../shared/utils/audit'; // 👈 Importado correctamente
import { AuditAction } from '../audit/audit-log.entity'; // 👈 Importado correctamente
import { In } from 'typeorm';

const router = Router();
router.use(authenticate, resolveTenant);

const userRepo = () => AppDataSource.getRepository(User);

// GET /api/users — listar usuarios del tenant
router.get('/', adminOrAbove, async (req: Request, res: Response) => {
  const users = await userRepo().find({
    where: { tenantId: req.tenant!.id },
    order: { name: 'ASC' },
    select: ['id', 'name', 'email', 'role', 'isActive', 'lastLoginAt', 'createdAt'],
  });
  res.json(users);
});

// POST /api/users — invitar usuario al negocio
router.post('/', adminOrAbove, async (req: Request, res: Response) => {
  const { name, email, password, role } = req.body;
  const tenantId = req.tenant!.id;

  // Verificar límite de usuarios según plan (Excluyendo cuentas ADMIN/SUPERADMIN)
  const currentCount = await userRepo().count({ 
    where: { 
      tenantId, 
      isActive: true,
      role: In([UserRole.CASHIER, UserRole.WAREHOUSE, UserRole.SUPERVISOR])
    } 
  });

  const sub = await AppDataSource.getRepository(TenantSubscription).findOne({
    where: { tenantId, status: SubscriptionStatus.ACTIVE },
    relations: ['plan'],
    order: { createdAt: 'DESC' },
  });

  const maxUsers = sub?.plan?.maxUsers ?? 1;

  if (maxUsers !== -1 && currentCount >= maxUsers) {
    res.status(403).json({
      message: `Tu plan permite máximo ${maxUsers} usuario${maxUsers === 1 ? '' : 's'}. Actualiza tu plan para agregar más.`,
      code: 'USER_LIMIT_REACHED',
      upgradeRequired: true,
    });
    return;
  }

  const existing = await userRepo().findOne({ where: { email: email?.toLowerCase() } });
  if (existing) {
    res.status(400).json({ message: 'Ya existe un usuario con este correo.' });
    return;
  }

  // Solo el superadmin puede crear superadmins
  if (role === UserRole.SUPERADMIN && req.user!.role !== 'superadmin') {
    res.status(403).json({ message: 'No puedes asignar este rol.' });
    return;
  }

  const hashedPassword = await bcrypt.hash(password || 'Cambiar123!', 12);
  const user = userRepo().create({ name, email, password: hashedPassword, role, tenantId });
  const saved = await userRepo().save(user);

  // 📝 LOG: Registro de Auditoría de Creación exitosa
  await logAction({
    tenantId: req.tenant!.id,
    userId: req.user!.sub,
    userName: (req.user as any).name,
    action: AuditAction.CREATE,
    module: 'users',
    description: `Invitó al usuario ${saved.name} (${saved.email}) con el rol [${saved.role}]`
  });

  const { password: _, ...safeUser } = saved as any;
  res.status(201).json(safeUser);
});

// PATCH /api/users/:id — Editar datos de un usuario
router.patch('/:id', adminOrAbove, async (req: Request, res: Response) => {
  const { name, role, isActive } = req.body;
  const user = await userRepo().findOne({
    where: { id: req.params.id, tenantId: req.tenant!.id },
  });
  if (!user) { res.status(404).json({ message: 'Usuario no encontrado.' }); return; }

  // Detectar cambios antes de aplicar la mutación para el historial
  const cambios: string[] = [];
  if (name && name !== user.name) cambios.push(`nombre a "${name}"`);
  if (role && role !== user.role) cambios.push(`rol a "${role}"`);
  if (isActive !== undefined && isActive !== user.isActive) {
    cambios.push(isActive ? 'estado a [Activo]' : 'estado a [Inactivo]');
  }

  Object.assign(user, { name, role, isActive });
  const saved = await userRepo().save(user);

  // 📝 LOG: Registro de Auditoría de Modificación exitosa
  if (cambios.length > 0) {
    await logAction({
      tenantId: req.tenant!.id,
      userId: req.user!.sub,
      userName: (req.user as any).name,
      action: AuditAction.UPDATE,
      module: 'users',
      description: `Modificó al usuario ${saved.name} (${saved.email}): Actualizó ${cambios.join(', ')}.`
    });
  }

  const { password: _, ...safe } = saved as any;
  res.json(safe);
});

// PATCH /api/users/me/password — cambiar propia contraseña
router.patch('/me/password', async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  const user = await userRepo().findOne({
    where: { id: req.user!.sub },
    select: ['id', 'password', 'name', 'email'],
  });
  if (!user) { res.status(404).json({ message: 'Usuario no encontrado.' }); return; }

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) { res.status(400).json({ message: 'Contraseña actual incorrecta.' }); return; }

  user.password = await bcrypt.hash(newPassword, 12);
  await userRepo().save(user);

  // 📝 LOG: Registro de cambio de contraseña
  await logAction({
    tenantId: req.tenant!.id,
    userId: user.id,
    userName: user.name,
    action: AuditAction.UPDATE,
    module: 'auth',
    description: `El usuario actualizó su propia contraseña de acceso.`
  });

  res.json({ message: 'Contraseña actualizada.' });
});

// DELETE /api/users/:id — Eliminar físicamente un usuario del tenant
router.delete('/:id', adminOrAbove, async (req: Request, res: Response) => {
  const userRepoInstance = userRepo();
  
  const user = await userRepoInstance.findOne({
    where: { id: req.params.id, tenantId: req.tenant!.id },
  });

  if (!user) {
    res.status(404).json({ message: 'Usuario no encontrado.' });
    return;
  }

  if (user.id === req.user!.sub) {
    res.status(400).json({ message: 'No puedes eliminar tu propio usuario administrador.' });
    return;
  }

  // Verificar si el usuario tiene ventas asociadas
  const salesRepo = AppDataSource.getRepository('Sale');
  const hasSales = await salesRepo.count({ 
    where: { cashierId: user.id } 
  });

  let message: string;
  let deactivated = false;

  if (hasSales > 0) {
    // Si tiene ventas, solo desactivar
    user.isActive = false;
    await userRepoInstance.save(user);
    message = `El usuario ${user.name} tiene ventas registradas. Ha sido desactivado pero no eliminado.`;
    deactivated = true;
    
    // 📝 LOG: Registro de desactivación
    await logAction({
      tenantId: req.tenant!.id,
      userId: req.user!.sub,
      userName: (req.user as any).name,
      action: AuditAction.UPDATE,
      module: 'users',
      description: `Desactivó al usuario ${user.name} (${user.email}) porque tiene ventas asociadas.`
    });
  } else {
    // Si no tiene ventas, eliminar físicamente
    await userRepoInstance.remove(user);
    message = `Usuario ${user.name} eliminado correctamente.`;
    
    // 📝 LOG: Registro de eliminación
    await logAction({
      tenantId: req.tenant!.id,
      userId: req.user!.sub,
      userName: (req.user as any).name,
      action: AuditAction.DELETE,
      module: 'users',
      description: `Eliminó permanentemente al usuario ${user.name} (${user.email}) del sistema.`
    });
  }

  res.json({ 
    message, 
    deactivated,
    hasSales: hasSales > 0 
  });
});

export default router;
