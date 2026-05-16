import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { Supplier } from './supplier.entity';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { resolveTenant } from '../../shared/middleware/tenant.middleware';
import { ILike } from 'typeorm';
import { logAction } from '../../shared/utils/audit';
import { AuditAction } from '../audit/audit-log.entity';
import { User } from '../users/user.entity';

const router = Router();
router.use(authenticate, resolveTenant);

const repo = () => AppDataSource.getRepository(Supplier);

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

router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const supplierData = { ...req.body, tenantId };
    const newSupplier = repo().create(supplierData);
    const savedSupplier = await repo().save(newSupplier);

    // 🛡️ AUDITORÍA: Registrar creación de proveedor
    try {
      let userName = (req.user as any)?.name;
      
      if (!userName) {
        const userRepoInstance = AppDataSource.getRepository(User);
        const user = await userRepoInstance.findOne({ where: { id: req.user!.sub } });
        userName = user ? user.name : 'Usuario';
      }

      const supplierObj: any = savedSupplier;
      const detalles: string[] = [];
      if (supplierObj.phone) detalles.push(`Tel: ${supplierObj.phone}`);
      if (supplierObj.email) detalles.push(`Email: ${supplierObj.email}`);
      if (supplierObj.contactPerson) detalles.push(`Contacto: ${supplierObj.contactPerson}`);
      const infoAdicional = detalles.length > 0 ? ` (${detalles.join(', ')})` : '';

      await logAction({
        tenantId,
        userId: req.user!.sub,
        userName,
        action: AuditAction.CREATE,
        module: 'suppliers',
        description: `Creó el proveedor "${supplierObj.name}"${infoAdicional}`
      });

    } catch (auditError) {
      console.error('⚠️ Error al procesar el Log de Auditoría de creación de proveedor:', auditError);
    }

    res.status(201).json(savedSupplier);
  } catch (err: any) { 
    res.status(400).json({ message: err.message }); 
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  
  // Usamos find() en lugar de findOne() para evitar el error de tipos
  const results = await repo().find({ 
    where: { id: req.params.id, tenantId },
    take: 1
  });
  
  if (!results || results.length === 0) { 
    res.status(404).json({ message: 'Proveedor no encontrado.' }); 
    return; 
  }

  const supplier = results[0];
  
  // Guardamos valores anteriores para la auditoría
  const previousName = supplier.name;
  const previousPhone = supplier.phone;
  const previousEmail = supplier.email;
  const previousContactPerson = supplier.contactPerson;

  Object.assign(supplier, req.body);
  const updated = await repo().save(supplier);

  // 🛡️ AUDITORÍA: Registrar edición de proveedor
  try {
    let userName = (req.user as any)?.name;
    
    if (!userName) {
      const userRepoInstance = AppDataSource.getRepository(User);
      const user = await userRepoInstance.findOne({ where: { id: req.user!.sub } });
      userName = user ? user.name : 'Usuario';
    }

    const cambios: string[] = [];
    
    if (req.body.name && req.body.name !== previousName) {
      cambios.push(`cambió el nombre de "${previousName}" a "${req.body.name}"`);
    }
    
    if (req.body.phone !== undefined && req.body.phone !== previousPhone) {
      cambios.push(`actualizó el teléfono${req.body.phone ? ' a ' + req.body.phone : ''}`);
    }
    
    if (req.body.email !== undefined && req.body.email !== previousEmail) {
      cambios.push(`actualizó el email${req.body.email ? ' a ' + req.body.email : ''}`);
    }
    
    if (req.body.contactPerson !== undefined && req.body.contactPerson !== previousContactPerson) {
      cambios.push(`cambió la persona de contacto${req.body.contactPerson ? ' a ' + req.body.contactPerson : ''}`);
    }
    
    if (req.body.address !== undefined) {
      cambios.push('actualizó la dirección');
    }
    
    if (req.body.notes !== undefined) {
      cambios.push('modificó las notas');
    }

    const descripcionCambios = cambios.length > 0
      ? `Editó el proveedor "${previousName}": ${cambios.join('. ')}`
      : `Editó el proveedor "${previousName}"`;

    await logAction({
      tenantId,
      userId: req.user!.sub,
      userName,
      action: AuditAction.UPDATE,
      module: 'suppliers',
      description: descripcionCambios
    });

  } catch (auditError) {
    console.error('⚠️ Error al procesar el Log de Auditoría de edición de proveedor:', auditError);
  }

  res.json(updated);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  
  // Usamos find() en lugar de findOne() para evitar el error de tipos
  const results = await repo().find({ 
    where: { id: req.params.id, tenantId },
    take: 1
  });
  
  if (!results || results.length === 0) { 
    res.status(404).json({ message: 'Proveedor no encontrado.' }); 
    return; 
  }

  const supplier = results[0];
  const supplierName = supplier.name;

  await repo().update(
    { id: req.params.id, tenantId }, 
    { isActive: false }
  );

  // 🛡️ AUDITORÍA: Registrar eliminación (desactivación) de proveedor
  try {
    let userName = (req.user as any)?.name;
    
    if (!userName) {
      const userRepoInstance = AppDataSource.getRepository(User);
      const user = await userRepoInstance.findOne({ where: { id: req.user!.sub } });
      userName = user ? user.name : 'Usuario';
    }

    await logAction({
      tenantId,
      userId: req.user!.sub,
      userName,
      action: AuditAction.DELETE,
      module: 'suppliers',
      description: `Eliminó (desactivó) al proveedor "${supplierName}"`
    });

  } catch (auditError) {
    console.error('⚠️ Error al procesar el Log de Auditoría de eliminación de proveedor:', auditError);
  }

  res.json({ message: 'Proveedor eliminado.' });
});

export default router;