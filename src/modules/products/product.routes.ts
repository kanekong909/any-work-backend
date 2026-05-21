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
// import { checkLimit } from '../../shared/utils/plan.utils';
import { upload } from '../../shared/middleware/upload.middleware';
import { v2 as cloudinary } from 'cloudinary';
import { StockMovement, MovementType, MovementReason } from './stock.movement'; // 👈 Importación del movimiento de stock

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const router = Router();
router.use(authenticate, resolveTenant, checkModule('inventory'));

const productRepo = () => AppDataSource.getRepository(Product);
const categoryRepo = () => AppDataSource.getRepository(Category);
const movementRepo = () => AppDataSource.getRepository(StockMovement);
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
      userName: operatorName || 'Usuario Desconocido',
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
      userName: operatorName || 'Usuario Desconocido',
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
    userName: operatorName || 'Usuario Desconocido',
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
      userName: operatorName || 'Usuario Desconocido',
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

// Imagen
// POST /api/products/:id/image
router.post('/:id/image', upload.single('image'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ message: 'No se recibió ninguna imagen.' });
    return;
  }

  const product = await productRepo().findOne({
    where: { id: req.params.id, tenantId: req.tenant!.id }
  });
  if (!product) { res.status(404).json({ message: 'Producto no encontrado.' }); return; }

  try {
    const result = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `nexoadmin/products/${req.tenant!.id}`,
          public_id: req.params.id,
          overwrite: true,
          transformation: [{ width: 400, height: 400, crop: 'limit' }],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file!.buffer);
    });

    await productRepo().update(product.id, { imageUrl: result.secure_url });
    res.json({ imageUrl: result.secure_url });
  } catch {
    res.status(500).json({ message: 'Error al subir la imagen.' });
  }
});

// STOCK
// GET /api/products/:id/movements - Historial de movimientos del producto
router.get('/:id/movements', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { limit = 50, page = 1, search, movementType } = req.query;
  const tenantId = req.tenant!.id;

  const movementRepo = AppDataSource.getRepository(StockMovement);
  
  const query = movementRepo
    .createQueryBuilder('sm')
    .leftJoinAndSelect('sm.user', 'user')
    .where('sm.productId = :id', { id })
    .andWhere('sm.tenantId = :tenantId', { tenantId });
  
  // Filtro por tipo de movimiento
  if (movementType) {
    query.andWhere('sm.movementType = :movementType', { movementType });
  }
  
  // 👈 Búsqueda (sin incluir el enum)
  if (search && search.toString().trim()) {
    const searchTerm = `%${search.toString().trim()}%`;
    query.andWhere(
      `(
        CAST(sm.quantity AS TEXT) ILIKE :search OR
        CAST(sm.stockBefore AS TEXT) ILIKE :search OR
        CAST(sm.stockAfter AS TEXT) ILIKE :search OR
        sm.notes ILIKE :search OR
        sm.referenceId ILIKE :search OR
        user.name ILIKE :search
      )`,
      { search: searchTerm }
    );
  }
  
  const [items, total] = await query
    .orderBy('sm.createdAt', 'DESC')
    .take(Number(limit))
    .skip((Number(page) - 1) * Number(limit))
    .getManyAndCount();

  res.json({
    items,
    total,
    page: Number(page),
    limit: Number(limit)
  });
});
// GET /api/products/:id/movements/summary - Resumen de movimientos del producto
router.get('/:id/movements/summary', async (req: Request, res: Response) => {
  const { id } = req.params;
  const tenantId = req.tenant!.id;

  const movementRepo = AppDataSource.getRepository(StockMovement);
  
  const summary = await movementRepo
    .createQueryBuilder('sm')
    .select('sm.reason', 'reason')
    .addSelect('SUM(sm.quantity)', 'totalQuantity')
    .addSelect('COUNT(sm.id)', 'totalMovements')
    .where('sm.productId = :id', { id })
    .andWhere('sm.tenantId = :tenantId', { tenantId })
    .groupBy('sm.reason')
    .getRawMany();

  const totalIn = await movementRepo
    .createQueryBuilder('sm')
    .where('sm.productId = :id', { id })
    .andWhere('sm.tenantId = :tenantId', { tenantId })
    .andWhere('sm.movementType = :type', { type: MovementType.IN })
    .select('SUM(sm.quantity)', 'total')
    .getRawOne();

  const totalOut = await movementRepo
    .createQueryBuilder('sm')
    .where('sm.productId = :id', { id })
    .andWhere('sm.tenantId = :tenantId', { tenantId })
    .andWhere('sm.movementType = :type', { type: MovementType.OUT })
    .select('SUM(sm.quantity)', 'total')
    .getRawOne();

  res.json({
    summary,
    totals: {
      entries: Number(totalIn?.total || 0),
      exits: Number(totalOut?.total || 0),
      balance: Number(totalIn?.total || 0) - Number(totalOut?.total || 0)
    }
  });
});
// POST /api/products/:id/adjust-stock - Ajuste manual de stock
router.post('/:id/adjust-stock', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { quantity, reason, notes } = req.body;
  const tenantId = req.tenant!.id;
  const userId = req.user!.sub;

  if (!quantity || quantity === 0) {
    res.status(400).json({ message: 'La cantidad es requerida y debe ser diferente de 0' });
    return;
  }

  const validReasons = ['INVENTORY_ADJUSTMENT', 'DAMAGED', 'EXPIRED'];
  if (!reason || !validReasons.includes(reason)) {
    res.status(400).json({ message: 'Razón de ajuste no válida. Use: INVENTORY_ADJUSTMENT, DAMAGED o EXPIRED' });
    return;
  }

  try {
    const product = await productRepo().findOne({ where: { id, tenantId } });
    if (!product) {
      res.status(404).json({ message: 'Producto no encontrado' });
      return;
    }

    // 👈 NORMALIZAR CANTIDAD SEGÚN LA UNIDAD DEL PRODUCTO
    let quantityNum = Number(quantity);
    
    // Si el producto es por unidad, forzar a número entero
    if (product.unit === 'unit') {
      quantityNum = Math.round(quantityNum);
    } else {
      // Para kg, litros, etc., mantener 3 decimales
      quantityNum = Math.round(quantityNum * 1000) / 1000;
    }

    // Redondear stock actual a 3 decimales
    const stockBefore = Number(Number(product.stock).toFixed(3));
    let stockAfter = Number((stockBefore + quantityNum).toFixed(3));

    if (product.unit === 'unit') {
      stockAfter = Math.round(stockAfter);
    }
    
    // Validar stock suficiente si es salida
    if (quantityNum < 0 && stockAfter < 0) {
      res.status(400).json({ message: `Stock insuficiente. Stock actual: ${stockBefore}` });
      return;
    }

    // Asegurar que no quede negativo por error de precisión
    if (stockAfter < 0 && stockAfter > -0.001) {
      stockAfter = 0;
    }

    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Actualizar stock con valor redondeado
      await queryRunner.manager.update(Product, id, { stock: stockAfter });
      
      const movementType = quantityNum > 0 ? MovementType.IN : MovementType.OUT;
      let movementReason: MovementReason;
      
      switch (reason) {
        case 'DAMAGED':
          movementReason = MovementReason.DAMAGED;
          break;
        case 'EXPIRED':
          movementReason = MovementReason.EXPIRED;
          break;
        default:
          movementReason = MovementReason.INVENTORY_ADJUSTMENT;
      }
      
      const movement = new StockMovement();
      movement.productId = id;
      movement.movementType = movementType;
      movement.reason = movementReason;
      movement.quantity = Math.abs(quantityNum);
      movement.stockBefore = stockBefore;
      movement.stockAfter = stockAfter;
      movement.unitCost = product.costPrice;
      movement.notes = notes || `Ajuste manual: ${reason}`;
      movement.userId = userId;
      movement.tenantId = tenantId;
      
      const savedMovement = await queryRunner.manager.save(movement);
      await queryRunner.commitTransaction();
      
      const updatedProduct = await productRepo().findOne({ where: { id, tenantId } });
      
      const operatorName = await getUserName(req);
      await logAction({
        tenantId: req.tenant!.id,
        userId: req.user!.sub,
        userName: operatorName,
        action: AuditAction.UPDATE,
        module: 'inventory',
        description: `Ajustó stock de "${updatedProduct?.name}": ${quantityNum > 0 ? '+' : ''}${quantityNum} unidades. Motivo: ${reason}`
      });
      
      res.json({
        message: 'Ajuste de stock realizado exitosamente',
        movement: savedMovement,
        product: updatedProduct
      });
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});
// POST /api/products/:id/add-stock - Entrada de stock (compra)
router.post('/:id/add-stock', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { quantity, unitCost, referenceId, notes } = req.body;
  const tenantId = req.tenant!.id;
  const userId = req.user!.sub;

  if (!quantity || quantity <= 0) {
    res.status(400).json({ message: 'La cantidad debe ser mayor a 0' });
    return;
  }

  try {
    const product = await productRepo().findOne({ where: { id, tenantId } });
    if (!product) {
      res.status(404).json({ message: 'Producto no encontrado' });
      return;
    }

    const stockBefore = Number(product.stock);
    const quantityNum = Number(quantity);
    const stockAfter = stockBefore + quantityNum;

    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.update(Product, id, { stock: stockAfter });
      
      const movement = new StockMovement(); // 👈 Usar new en lugar de create
      movement.productId = id;
      movement.movementType = MovementType.IN;
      movement.reason = MovementReason.PURCHASE;
      movement.quantity = quantityNum;
      movement.stockBefore = stockBefore;
      movement.stockAfter = stockAfter;
      movement.unitCost = unitCost || product.costPrice;
      movement.referenceId = referenceId || null;
      movement.referenceType = 'purchase_order';
      movement.notes = notes || 'Entrada por compra';
      movement.userId = userId;
      movement.tenantId = tenantId;
      
      const savedMovement = await queryRunner.manager.save(movement);
      await queryRunner.commitTransaction();
      
      const updatedProduct = await productRepo().findOne({ where: { id, tenantId } });
      
      const operatorName = await getUserName(req);
      await logAction({
        tenantId: req.tenant!.id,
        userId: req.user!.sub,
        userName: operatorName,
        action: AuditAction.UPDATE,
        module: 'inventory',
        description: `Registró entrada de stock para "${updatedProduct?.name}": +${quantity} unidades`
      });
      
      res.json({
        message: 'Entrada de stock registrada exitosamente',
        movement: savedMovement,
        product: updatedProduct
      });
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});
// POST /api/products/:id/remove-stock - Salida de stock
router.post('/:id/remove-stock', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { quantity, reason, referenceId, notes } = req.body;
  const tenantId = req.tenant!.id;
  const userId = req.user!.sub;

  if (!quantity || quantity <= 0) {
    res.status(400).json({ message: 'La cantidad debe ser mayor a 0' });
    return;
  }

  const validReasons = ['SALE', 'DAMAGED', 'EXPIRED', 'SUPPLIER_RETURN', 'CUSTOMER_RETURN'];
  if (!reason || !validReasons.includes(reason)) {
    res.status(400).json({ message: 'Razón no válida. Use: SALE, DAMAGED, EXPIRED, SUPPLIER_RETURN o CUSTOMER_RETURN' });
    return;
  }

  try {
    const product = await productRepo().findOne({ where: { id, tenantId } });
    if (!product) {
      res.status(404).json({ message: 'Producto no encontrado' });
      return;
    }

    const stockBefore = Number(product.stock);
    const quantityNum = Number(quantity);
    const stockAfter = stockBefore - quantityNum;
    
    if (stockAfter < 0) {
      res.status(400).json({ message: `Stock insuficiente. Stock actual: ${stockBefore}` });
      return;
    }

    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.update(Product, id, { stock: stockAfter });
      
      const movement = movementRepo().create({
        productId: id,
        movementType: MovementType.OUT,
        reason,
        quantity: quantityNum,
        stockBefore,
        stockAfter,
        unitCost: product.costPrice,
        referenceId,
        referenceType: reason === 'SALE' ? 'sale' : 'adjustment',
        notes: notes || `Salida por ${reason}`,
        userId,
        tenantId
      });
      
      const savedMovement = await queryRunner.manager.save(movement);
      await queryRunner.commitTransaction();
      
      const updatedProduct = await productRepo().findOne({ where: { id, tenantId } });
      
      const operatorName = await getUserName(req);
      await logAction({
        tenantId: req.tenant!.id,
        userId: req.user!.sub,
        userName: operatorName,
        action: AuditAction.UPDATE,
        module: 'inventory',
        description: `Registró salida de stock para "${updatedProduct?.name}": -${quantity} unidades. Motivo: ${reason}`
      });
      
      res.json({
        message: 'Salida de stock registrada exitosamente',
        movement: savedMovement,
        product: updatedProduct
      });
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});
// GET /api/products/reports/low-stock - Productos con bajo stock
router.get('/reports/low-stock', async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  
  const products = await productRepo().find({
    where: { tenantId, isActive: true },
    relations: ['category']
  });

  const lowStockProducts = products
    .filter(p => Number(p.stock) <= Number(p.minStock))
    .map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      stock: Number(p.stock),
      minStock: Number(p.minStock),
      deficit: Number(p.minStock) - Number(p.stock),
      unit: p.unit,
      category: p.category?.name
    }));

  res.json({
    total: lowStockProducts.length,
    items: lowStockProducts,
    generatedAt: new Date()
  });
});

export default router;
