import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { Product } from './product.entity';
import { Category } from './category.entity';
import { User } from '../users/user.entity'; // 👈 Importación requerida para consulta de empleados
import { authenticate } from '../../shared/middleware/auth.middleware';
import { resolveTenant, checkModule } from '../../shared/middleware/tenant.middleware';
import { Like, ILike } from 'typeorm';
import { logAction } from '../../shared/utils/audit'; // 👈 Helper de auditoría
import { AuditAction } from '../audit/audit-log.entity'; // 👈 Enum de acciones

const router = Router();
router.use(authenticate, resolveTenant, checkModule('inventory'));

const productRepo = () => AppDataSource.getRepository(Product);
const categoryRepo = () => AppDataSource.getRepository(Category);

// Helper interno para resolver nombres de empleados de forma segura en este router
async function getUserName(req: Request): Promise<string> {
  let name = (req.user as any)?.name;
  if (!name) {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.user!.sub } });
    name = user ? user.name : 'Personal de Inventario';
  }
  return name;
}

// GET /api/products
router.get('/', async (req: Request, res: Response) => {
  const { search, categoryId, lowStock, page = 1, limit = 20 } = req.query;
  const tenantId = req.tenant!.id;

  const where: any = { tenantId, isActive: true };
  if (search) where.name = ILike(`%${search}%`);
  if (categoryId) where.categoryId = categoryId;

  const [items, total] = await productRepo().findAndCount({
    where,
    relations: ['category'],
    order: { name: 'ASC' },
    take: Number(limit),
    skip: (Number(page) - 1) * Number(limit),
  });

  const result = lowStock === 'true'
    ? items.filter(p => p.stock <= p.minStock)
    : items;

  res.json({ items: result, total, page: Number(page), limit: Number(limit) });
});

// GET /api/products/:id
router.get('/:id', async (req: Request, res: Response) => {
  const product = await productRepo().findOne({
    where: { id: req.params.id, tenantId: req.tenant!.id },
    relations: ['category'],
  });
  if (!product) {
    res.status(404).json({ message: 'Producto no encontrado.' });
    return;
  }
  res.json(product);
});

// POST /api/products — Crear producto nuevo
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = { ...req.body };
    if (!body.categoryId) body.categoryId = null;
    const product = productRepo().create({ ...body, tenantId: req.tenant!.id });
    const saved = await productRepo().save(product);

    // 📝 LOG: Forzamos el casteo a any para evitar la advertencia del compilador
    const s = saved as any;
    const operatorName = await getUserName(req);
    await logAction({
      tenantId: req.tenant!.id,
      userId: req.user!.sub,
      userName: operatorName,
      action: AuditAction.CREATE,
      module: 'inventory',
      description: `Creó el producto "${s.name}" con un stock inicial de ${s.stock} unidades (Precio venta: $${Number(s.salePrice).toLocaleString('es-CO')}).`
    });

    res.status(201).json(saved);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// PATCH /api/products/:id — Modificar producto existente
router.patch('/:id', async (req: Request, res: Response) => {
  const product = await productRepo().findOne({
    where: { id: req.params.id, tenantId: req.tenant!.id },
  });
  if (!product) {
    res.status(404).json({ message: 'Producto no encontrado.' });
    return;
  }
  const updates = { ...req.body };
  if (!updates.categoryId) updates.categoryId = null;

  const cambios: string[] = [];
  if (updates.name && updates.name !== product.name) cambios.push(`nombre a "${updates.name}"`);
  if (updates.stock !== undefined && Number(updates.stock) !== Number(product.stock)) {
    cambios.push(`stock de ${product.stock} a ${updates.stock}`);
  }
  if (updates.salePrice !== undefined && Number(updates.salePrice) !== Number(product.salePrice)) {
    cambios.push(`precio de venta a $${Number(updates.salePrice).toLocaleString('es-CO')}`);
  }

  Object.assign(product, updates);
  const saved = await productRepo().save(product);

   // 📝 LOG: Casteo a any en el objeto final guardado
  const s = saved as any;
  if (cambios.length > 0) {
    const operatorName = await getUserName(req);
    await logAction({
      tenantId: req.tenant!.id,
      userId: req.user!.sub,
      userName: operatorName,
      action: AuditAction.UPDATE,
      module: 'inventory',
      description: `Actualizó el producto "${s.name}": Cambió ${cambios.join(', ')}.`
    });
  }

  res.json(saved);
});

// DELETE /api/products/:id (soft delete)
router.delete('/:id', async (req: Request, res: Response) => {
  const product = await productRepo().findOne({
    where: { id: req.params.id, tenantId: req.tenant!.id }
  });
  
  if (!product) {
    res.status(404).json({ message: 'Producto no encontrado.' });
    return;
  }

  await productRepo().update(
    { id: req.params.id, tenantId: req.tenant!.id },
    { isActive: false }
  );

  // 📝 LOG: Eliminación Lógica de Producto
  const operatorName = await getUserName(req);
  await logAction({
    tenantId: req.tenant!.id,
    userId: req.user!.sub,
    userName: operatorName,
    action: AuditAction.DELETE,
    module: 'inventory',
    description: `Eliminó el producto "${product.name}" del catálogo del negocio.`
  });

  res.json({ message: 'Producto eliminado.' });
});

// ── Categorías ─────────────────────────────────────────────────

// GET /api/products/categories/all
router.get('/categories/all', async (req: Request, res: Response) => {
  const categories = await categoryRepo().find({
    where: { tenantId: req.tenant!.id },
    order: { name: 'ASC' },
  });
  res.json(categories);
});

// POST /api/products/categories — Crear Categoría Nueva
router.post('/categories', async (req: Request, res: Response) => {
  try {
    const category = categoryRepo().create({ ...req.body, tenantId: req.tenant!.id });
    const saved = await categoryRepo().save(category);

    // 📝 LOG: Creación de Categoría Corregida
    const c = saved as any; // Evita el error de inferencia de arrays
    const operatorName = await getUserName(req);
    await logAction({
      tenantId: req.tenant!.id,
      userId: req.user!.sub,
      userName: operatorName,
      action: AuditAction.CREATE,
      module: 'inventory', 
      description: `Creó una nueva categoría de productos denominada "${c.name}".` // 👈 Corregido aquí
    });

    res.status(201).json(saved);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// PATCH /api/products/categories/:id — Modificar Categoría Existente
router.patch('/categories/:id', async (req: Request, res: Response) => {
  const repo = categoryRepo();
  const cat = await repo.findOne({ where: { id: req.params.id, tenantId: req.tenant!.id } });
  if (!cat) { res.status(404).json({ message: 'Categoría no encontrada.' }); return; }
  Object.assign(cat, req.body);
  res.json(await repo.save(cat));
});

// DELETE /api/products/categories/:id — Eliminar Categoría (soft delete)
router.delete('/categories/:id', async (req: Request, res: Response) => {
  await categoryRepo().delete({ id: req.params.id, tenantId: req.tenant!.id });
  res.json({ message: 'Categoría eliminada.' });
});

export default router;
