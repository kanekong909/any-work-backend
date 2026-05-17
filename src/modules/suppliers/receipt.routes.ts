import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { SupplierReceipt, SupplierReceiptItem } from './supplier-receipt.entity';
import { Product } from '../products/product.entity';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { resolveTenant } from '../../shared/middleware/tenant.middleware';

const router = Router();
router.use(authenticate, resolveTenant);

const receiptRepo = () => AppDataSource.getRepository(SupplierReceipt);

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
  
  // 🔥 FILTRAR RESULTADOS (si hay búsqueda)
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
    total: search ? filteredItems.length : total 
  });
});

// POST /api/receipts
router.post('/', async (req: Request, res: Response) => {
  try {
    const { supplierId, invoiceNumber, notes, status, items } = req.body;

    if (!items?.length) {
      res.status(400).json({ message: 'Debes agregar al menos un item.' });
      return;
    }

    const receipt = receiptRepo().create({
      tenantId: req.tenant!.id,
      supplierId: supplierId || null,
      invoiceNumber,
      notes,
      status,
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

    const saved = await receiptRepo().save(receipt);

    // Actualizar stock si el producto está en inventario
    for (const item of items) {
      if (item.productId) {
        const productRepo = AppDataSource.getRepository(Product);
        const product = await productRepo.findOne({
          where: { id: item.productId, tenantId: req.tenant!.id }
        });
        if (product) {
          await productRepo.update(product.id, {
            stock: Number(product.stock) + Number(item.quantity),
          });
        }
      }
    }

    res.status(201).json(saved);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/receipts/:id
router.put('/:id', async (req: Request, res: Response) => {
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

    // Actualizar campos básicos
    existingReceipt.supplierId = supplierId || null;
    existingReceipt.invoiceNumber = invoiceNumber;
    existingReceipt.notes = notes;
    existingReceipt.status = status;

    // Eliminar items antiguos
    await AppDataSource.query(`DELETE FROM supplier_receipt_items WHERE "receiptId" = $1`, [id]);

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

    const saved = await receiptRepo().save(existingReceipt);
    res.json(saved);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/receipts/:id
router.delete('/:id', async (req: Request, res: Response) => {
  await AppDataSource.query(`DELETE FROM supplier_receipt_items WHERE "receiptId" = $1`, [req.params.id]);
  await receiptRepo().delete({ id: req.params.id, tenantId: req.tenant!.id });
  res.json({ message: 'Recepción eliminada.' });
});

export default router;