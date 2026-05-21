// supplier-receipt.routes.ts - Versión mejorada

import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { SupplierReceipt, SupplierReceiptItem, ReceiptStatus } from './supplier-receipt.entity';
import { Product } from '../products/product.entity';
import { StockMovement, MovementType, MovementReason } from '../products/stock.movement';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { resolveTenant, checkModule } from '../../shared/middleware/tenant.middleware';
import { logAction } from '../../shared/utils/audit';
import { AuditAction } from '../audit/audit-log.entity';
import { User } from '../users/user.entity';

const router = Router();
router.use(authenticate, resolveTenant, checkModule('inventory'));

const receiptRepo = () => AppDataSource.getRepository(SupplierReceipt);
const productRepo = () => AppDataSource.getRepository(Product);
const movementRepo = () => AppDataSource.getRepository(StockMovement);

// Helper para obtener nombre del usuario
async function getUserName(req: Request): Promise<string> {
  let name = (req.user as any)?.name;
  if (!name) {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.user!.sub } });
    name = user ? user.name : 'Usuario Desconocido';
  }
  return name;
}

// GET /api/receipts
router.get('/', async (req: Request, res: Response) => {
  const { supplierId, search, page = 1, limit = 20 } = req.query;
  const where: any = { tenantId: req.tenant!.id };
  
  if (supplierId) where.supplierId = supplierId;
  
  const [items, total] = await receiptRepo().findAndCount({
    where,
    order: { createdAt: 'DESC' },
    take: Number(limit),
    skip: (Number(page) - 1) * Number(limit),
    relations: ['supplier', 'receivedBy'],
  });
  
  let filteredItems = items;
  if (search && String(search).trim()) {
    const searchTerm = String(search).toLowerCase().trim();
    filteredItems = items.filter(receipt => {
      const supplierMatch = receipt.supplier?.name?.toLowerCase().includes(searchTerm);
      const invoiceMatch = receipt.invoiceNumber?.toLowerCase().includes(searchTerm);
      const productMatch = receipt.items?.some(item => 
        item.productName?.toLowerCase().includes(searchTerm)
      );
      return supplierMatch || invoiceMatch || productMatch;
    });
  }
  
  res.json({ 
    items: filteredItems, 
    total: search ? filteredItems.length : total,
    page: Number(page),
    limit: Number(limit)
  });
});

// GET /api/receipts/:id - Obtener una recepción específica
router.get('/:id', async (req: Request, res: Response) => {
  const receipt = await receiptRepo().findOne({
    where: { id: req.params.id, tenantId: req.tenant!.id },
    relations: ['supplier', 'receivedBy', 'items']
  });
  
  if (!receipt) {
    res.status(404).json({ message: 'Recepción no encontrada' });
    return;
  }
  
  res.json(receipt);
});

// POST /api/receipts - Crear recepción con movimientos de stock
router.post('/', async (req: Request, res: Response) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const { supplierId, invoiceNumber, notes, status, items } = req.body;

    if (!items?.length) {
      res.status(400).json({ message: 'Debes agregar al menos un item.' });
      return;
    }

    // Crear la recepción
    const receipt = receiptRepo().create({
      tenantId: req.tenant!.id,
      supplierId: supplierId || null,
      invoiceNumber,
      notes,
      status: status || ReceiptStatus.COMPLETE,
      receivedById: req.user!.sub,
    });

    receipt.items = items.map((i: any) => {
      const item = new SupplierReceiptItem();
      item.productName = i.productName;
      item.productId = i.productId || null;
      item.quantity = i.quantity;
      item.unit = i.unit || 'unit';
      item.unitCost = i.unitCost || 0;
      item.condition = i.condition || 'bueno';
      item.notes = i.notes || '';
      return item;
    });

    const savedReceipt = await queryRunner.manager.save(receipt);
    
    const movements = [];
    const updatedProducts = [];

    // Procesar cada item y actualizar stock con movimiento
    for (const item of items) {
      if (item.productId) {
        // Obtener producto actual con LOCK para evitar condiciones de carrera
        const product = await queryRunner.manager.findOne(Product, {
          where: { id: item.productId, tenantId: req.tenant!.id },
          lock: { mode: 'pessimistic_write' }
        });
        
        if (product) {
          const stockBefore = Number(product.stock);
          const quantity = Number(item.quantity);
          const stockAfter = stockBefore + quantity;
          
          // Actualizar stock
          await queryRunner.manager.update(Product, product.id, {
            stock: stockAfter,
            costPrice: item.unitCost || product.costPrice // Actualizar costo si se proporciona
          });
          
          // Registrar movimiento de stock
          const movement = movementRepo().create({
            productId: product.id,
            movementType: MovementType.IN,
            reason: MovementReason.SUPPLIER_RECEIPT,
            quantity: quantity,
            stockBefore: stockBefore,
            stockAfter: stockAfter,
            unitCost: item.unitCost || product.costPrice,
            referenceId: savedReceipt.id,
            referenceType: 'supplier_receipt',
            notes: `Recepción de compra - Factura: ${invoiceNumber || 'N/A'} - Item: ${item.productName}`,
            userId: req.user!.sub,
            tenantId: req.tenant!.id
          });
          
          const savedMovement = await queryRunner.manager.save(movement);
          movements.push(savedMovement);
          updatedProducts.push({ ...product, newStock: stockAfter });
        }
      }
    }

    await queryRunner.commitTransaction();

    // Registrar auditoría
    const operatorName = await getUserName(req);
    await logAction({
      tenantId: req.tenant!.id,
      userId: req.user!.sub,
      userName: operatorName,
      action: AuditAction.CREATE,
      module: 'inventory',
      description: `Registró recepción de compra #${savedReceipt.id.slice(0, 8)} con ${items.length} items. Factura: ${invoiceNumber || 'N/A'}`
    });

    res.status(201).json({
      receipt: savedReceipt,
      movements: movements,
      updatedProducts: updatedProducts
    });
    
  } catch (err: any) {
    await queryRunner.rollbackTransaction();
    console.error('Error al crear recepción:', err);
    res.status(400).json({ message: err.message });
  } finally {
    await queryRunner.release();
  }
});

// PUT /api/receipts/:id - Actualizar recepción (con ajuste de stock)
router.put('/:id', async (req: Request, res: Response) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const { id } = req.params;
    const { supplierId, invoiceNumber, notes, status, items } = req.body;

    // Buscar la recepción existente
    const existingReceipt = await receiptRepo().findOne({
      where: { id, tenantId: req.tenant!.id },
      relations: ['items']
    });

    if (!existingReceipt) {
      res.status(404).json({ message: 'Recepción no encontrada' });
      return;
    }

    // Revertir stock anterior (eliminar movimientos previos)
    const oldMovements = await movementRepo().find({
      where: { referenceId: id, referenceType: 'supplier_receipt', tenantId: req.tenant!.id }
    });

    for (const oldMovement of oldMovements) {
      const product = await queryRunner.manager.findOne(Product, {
        where: { id: oldMovement.productId, tenantId: req.tenant!.id }
      });
      
      if (product) {
        // Revertir el stock (restar lo que se había sumado)
        const stockBefore = Number(product.stock);
        const quantityToRevert = Number(oldMovement.quantity);
        const stockAfter = stockBefore - quantityToRevert;
        
        await queryRunner.manager.update(Product, product.id, { stock: stockAfter });
      }
      
      // Eliminar movimiento antiguo
      await queryRunner.manager.delete(StockMovement, oldMovement.id);
    }

    // Actualizar campos básicos
    existingReceipt.supplierId = supplierId || null;
    existingReceipt.invoiceNumber = invoiceNumber;
    existingReceipt.notes = notes;
    existingReceipt.status = status;

    // Eliminar items antiguos
    await queryRunner.manager.delete(SupplierReceiptItem, { receiptId: id });

    // Crear nuevos items
    existingReceipt.items = items.map((i: any) => {
      const item = new SupplierReceiptItem();
      item.productName = i.productName;
      item.productId = i.productId || null;
      item.quantity = i.quantity;
      item.unit = i.unit || 'unit';
      item.unitCost = i.unitCost || 0;
      item.condition = i.condition || 'bueno';
      item.notes = i.notes || '';
      return item;
    });

    const savedReceipt = await queryRunner.manager.save(existingReceipt);
    
    const newMovements = [];

    // Aplicar nuevo stock
    for (const item of items) {
      if (item.productId) {
        const product = await queryRunner.manager.findOne(Product, {
          where: { id: item.productId, tenantId: req.tenant!.id }
        });
        
        if (product) {
          const stockBefore = Number(product.stock);
          const quantity = Number(item.quantity);
          const stockAfter = stockBefore + quantity;
          
          await queryRunner.manager.update(Product, product.id, { stock: stockAfter });
          
          const movement = movementRepo().create({
            productId: product.id,
            movementType: MovementType.IN,
            reason: MovementReason.SUPPLIER_RECEIPT,
            quantity: quantity,
            stockBefore: stockBefore,
            stockAfter: stockAfter,
            unitCost: item.unitCost || product.costPrice,
            referenceId: savedReceipt.id,
            referenceType: 'supplier_receipt',
            notes: `Recepción de compra (actualizada) - Factura: ${invoiceNumber || 'N/A'}`,
            userId: req.user!.sub,
            tenantId: req.tenant!.id
          });
          
          const savedMovement = await queryRunner.manager.save(movement);
          newMovements.push(savedMovement);
        }
      }
    }

    await queryRunner.commitTransaction();

    const operatorName = await getUserName(req);
    await logAction({
      tenantId: req.tenant!.id,
      userId: req.user!.sub,
      userName: operatorName,
      action: AuditAction.UPDATE,
      module: 'inventory',
      description: `Actualizó recepción de compra #${id.slice(0, 8)}. Factura: ${invoiceNumber || 'N/A'}`
    });

    res.json({
      receipt: savedReceipt,
      movements: newMovements
    });
    
  } catch (err: any) {
    await queryRunner.rollbackTransaction();
    res.status(400).json({ message: err.message });
  } finally {
    await queryRunner.release();
  }
});

// DELETE /api/receipts/:id - Eliminar recepción y revertir stock
router.delete('/:id', async (req: Request, res: Response) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const { id } = req.params;
    
    // Obtener movimientos asociados
    const movements = await movementRepo().find({
      where: { referenceId: id, referenceType: 'supplier_receipt', tenantId: req.tenant!.id }
    });

    // Revertir stock para cada movimiento
    for (const movement of movements) {
      const product = await queryRunner.manager.findOne(Product, {
        where: { id: movement.productId, tenantId: req.tenant!.id }
      });
      
      if (product) {
        const stockBefore = Number(product.stock);
        const quantityToRevert = Number(movement.quantity);
        const stockAfter = stockBefore - quantityToRevert;
        
        await queryRunner.manager.update(Product, product.id, { stock: stockAfter });
      }
    }

    // Eliminar items de la recepción
    await queryRunner.manager.delete(SupplierReceiptItem, { receiptId: id });
    
    // Eliminar movimientos
    await queryRunner.manager.delete(StockMovement, { referenceId: id, referenceType: 'supplier_receipt' });
    
    // Eliminar recepción
    await queryRunner.manager.delete(SupplierReceipt, { id, tenantId: req.tenant!.id });

    await queryRunner.commitTransaction();

    const operatorName = await getUserName(req);
    await logAction({
      tenantId: req.tenant!.id,
      userId: req.user!.sub,
      userName: operatorName,
      action: AuditAction.DELETE,
      module: 'inventory',
      description: `Eliminó recepción de compra #${id.slice(0, 8)} y revirtió el stock asociado`
    });

    res.json({ message: 'Recepción eliminada y stock revertido correctamente.' });
    
  } catch (err: any) {
    await queryRunner.rollbackTransaction();
    res.status(400).json({ message: err.message });
  } finally {
    await queryRunner.release();
  }
});

// GET /api/receipts/:id/movements - Obtener movimientos de stock de una recepción
router.get('/:id/movements', async (req: Request, res: Response) => {
  const movements = await movementRepo().find({
    where: { referenceId: req.params.id, referenceType: 'supplier_receipt', tenantId: req.tenant!.id },
    relations: ['product', 'user'],
    order: { createdAt: 'ASC' }
  });
  
  res.json(movements);
});

export default router;