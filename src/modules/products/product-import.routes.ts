import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { AppDataSource } from '../../config/data-source';
import { Product } from './product.entity';
import { Category } from './category.entity';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { resolveTenant, checkModule } from '../../shared/middleware/tenant.middleware';
import { logAction } from '../../shared/utils/audit';
import { AuditAction } from '../audit/audit-log.entity';
import { User } from '../users/user.entity';
import { StockMovement, MovementType, MovementReason } from './stock.movement';
import { ILike } from 'typeorm';

const router = Router();
router.use(authenticate, resolveTenant, checkModule('inventory'));

// Configurar multer para memoria (procesar archivo sin guardar en disco)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB límite
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos CSV o Excel'));
    }
  }
});

const productRepo = () => AppDataSource.getRepository(Product);
const categoryRepo = () => AppDataSource.getRepository(Category);

async function getUserName(req: Request): Promise<string> {
  let name = (req.user as any)?.name;
  if (!name) {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.user!.sub } });
    name = user ? user.name : 'Usuario Desconocido';
  }
  return name;
}

// POST /api/products/import - Importar productos desde CSV/Excel
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const userId = req.user!.sub;

  if (!req.file) {
    res.status(400).json({ message: 'No se recibió ningún archivo.' });
    return;
  }

  try {
    let data: any[] = [];

    // Procesar según tipo de archivo
    if (req.file.mimetype === 'text/csv') {
      // Procesar CSV
      const csvContent = req.file.buffer.toString('utf-8');
      const lines = csvContent.split('\n');
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = lines[i].split(',').map(v => v.trim());
        const row: any = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] || '';
        });
        data.push(row);
      }
    } else {
      // Procesar Excel
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(worksheet);
    }

    if (data.length === 0) {
      res.status(400).json({ message: 'El archivo está vacío o no tiene datos válidos.' });
      return;
    }

    // Obtener categorías existentes
    const categories = await categoryRepo().find({ where: { tenantId } });
    const categoryMap = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));

    const results = {
      success: 0,
      errors: [] as any[],
      products: [] as any[]
    };

    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const rowNumber = i + 2; // +2 por cabecera y 0-index

        try {
          // Validar campos requeridos
          const name = row['nombre'] || row['name'];
          const salePrice = parseFloat(row['precio_venta'] || row['sale_price'] || row['precio'] || 0);
          const costPrice = parseFloat(row['precio_costo'] || row['cost_price'] || 0);
          const stock = parseFloat(row['stock'] || row['inventario'] || 0);
          const minStock = parseFloat(row['stock_minimo'] || row['min_stock'] || row['alerta'] || 0);
          const sku = row['sku'] || row['codigo'] || '';
          const description = row['descripcion'] || row['description'] || '';
          const unit = row['unidad'] || row['unit'] || 'unit';
          const categoryName = row['categoria'] || row['category'] || '';

          if (!name) {
            results.errors.push({ row: rowNumber, error: 'Nombre del producto es requerido' });
            continue;
          }

          if (isNaN(salePrice) || salePrice <= 0) {
            results.errors.push({ row: rowNumber, error: 'Precio de venta inválido' });
            continue;
          }

          // Buscar o crear categoría
          let categoryId: string | undefined = undefined;
          if (categoryName) {
            const existingCategory = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
            if (existingCategory) {
              categoryId = existingCategory.id;
            } else {
              // Crear nueva categoría
              const newCategory = categoryRepo().create({
                name: categoryName,
                tenantId,
                color: '#6366f1'
              });
              const savedCategory = await queryRunner.manager.save(newCategory);
              categoryId = savedCategory.id;
              categories.push(savedCategory);
              categoryMap.set(categoryName.toLowerCase(), savedCategory.id);
            }
          }

          // Verificar si ya existe producto con mismo SKU
          let existingProduct = null;
          if (sku) {
            existingProduct = await queryRunner.manager.findOne(Product, {
              where: { sku, tenantId }
            });
          }

          if (existingProduct) {
            // Actualizar producto existente
            const stockBefore = Number(existingProduct.stock);
            const stockAfter = stockBefore + stock;
            
            await queryRunner.manager.update(Product, existingProduct.id, {
              name,
              description,
              costPrice,
              salePrice,
              stock: stockAfter,
              minStock,
              unit,
              categoryId,
              isActive: true
            });

            // Registrar movimiento de stock si hay cambio
            if (stock > 0) {
              const movement = new StockMovement();
              movement.productId = existingProduct.id;
              movement.movementType = MovementType.IN;
              movement.reason = MovementReason.PURCHASE;
              movement.quantity = stock;
              movement.stockBefore = stockBefore;
              movement.stockAfter = stockAfter;
              movement.unitCost = costPrice;
              movement.referenceType = 'import';
              movement.notes = `Importación masiva - Stock actualizado`;
              movement.userId = userId;
              movement.tenantId = tenantId;
              await queryRunner.manager.save(movement);
            }

            results.success++;
            results.products.push({ ...existingProduct, name, updated: true });
          } else {
            // Crear nuevo producto
            const newProduct = productRepo().create({
              name,
              description,
              sku,
              costPrice,
              salePrice,
              stock,
              minStock,
              unit,
              categoryId,
              tenantId,
              isActive: true
            });
            
            const savedProduct = await queryRunner.manager.save(newProduct);
            
            // Registrar movimiento de stock inicial
            if (stock > 0) {
              const movement = new StockMovement();
              movement.productId = savedProduct.id;
              movement.movementType = MovementType.IN;
              movement.reason = MovementReason.INITIAL_STOCK;
              movement.quantity = stock;
              movement.stockBefore = 0;
              movement.stockAfter = stock;
              movement.unitCost = costPrice;
              movement.referenceType = 'import';
              movement.notes = `Importación masiva - Creación con stock inicial`;
              movement.userId = userId;
              movement.tenantId = tenantId;
              await queryRunner.manager.save(movement);
            }
            
            results.success++;
            results.products.push({ ...savedProduct, created: true });
          }
        } catch (rowError: any) {
          results.errors.push({ row: rowNumber, error: rowError.message });
        }
      }

      await queryRunner.commitTransaction();

      // Auditoría
      const operatorName = await getUserName(req);
      await logAction({
        tenantId,
        userId,
        userName: operatorName,
        action: AuditAction.CREATE,
        module: 'inventory',
        description: `Importación masiva de productos: ${results.success} productos procesados (${results.errors.length} errores)`
      });

      res.json({
        message: 'Importación completada',
        success: results.success,
        errors: results.errors,
        total: data.length
      });

    } catch (err: any) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

  } catch (err: any) {
    console.error('Error en importación:', err);
    res.status(500).json({ message: err.message || 'Error al procesar el archivo' });
  }
});

// GET /api/products/import/template - Descargar plantilla
router.get('/import/template', async (req: Request, res: Response) => {
  const template = [
    {
      'nombre': 'Ejemplo Producto',
      'sku': 'PROD-001',
      'descripcion': 'Descripción del producto',
      'precio_costo': 10000,
      'precio_venta': 15000,
      'stock': 10,
      'stock_minimo': 5,
      'unidad': 'unit',
      'categoria': 'Ejemplo'
    }
  ];

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(template);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');
  
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=plantilla_productos.xlsx');
  res.send(buffer);
});

// GET /api/products/export - Exportar productos a Excel
router.get('/export', async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const { search, categoryId, lowStock } = req.query;

  try {
    // Construir query según filtros
    const where: any = { tenantId, isActive: true };
    if (search) where.name = ILike(`%${search}%`);
    if (categoryId) where.categoryId = categoryId;

    let products = await productRepo().find({
      where,
      relations: ['category'],
      order: { name: 'ASC' }
    });

    // Filtrar por bajo stock si es necesario
    if (lowStock === 'true') {
      products = products.filter(p => Number(p.stock) <= Number(p.minStock));
    }

    // Preparar datos para exportar
    const exportData = products.map(p => ({
      'Nombre': p.name,
      'SKU / Código': p.sku || '',
      'Descripción': p.description || '',
      'Categoría': p.category?.name || 'Sin categoría',
      'Precio Costo (COP)': Number(p.costPrice).toLocaleString('es-CO'),
      'Precio Venta (COP)': Number(p.salePrice).toLocaleString('es-CO'),
      'Stock Actual': Number(p.stock).toFixed(3),
      'Stock Mínimo': Number(p.minStock).toFixed(3),
      'Unidad': p.unit === 'unit' ? 'Unidad' : p.unit,
      'Estado': p.isActive ? 'Activo' : 'Inactivo',
      'URL Imagen': p.imageUrl || '',
      'Fecha Creación': new Date(p.createdAt).toLocaleDateString('es-CO'),
      'Última Actualización': new Date(p.updatedAt).toLocaleDateString('es-CO')
    }));

    // Crear workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    
    // Ajustar anchos de columnas
    const colWidths = [
      { wch: 30 }, // Nombre
      { wch: 15 }, // SKU
      { wch: 40 }, // Descripción
      { wch: 15 }, // Categoría
      { wch: 18 }, // Precio Costo
      { wch: 18 }, // Precio Venta
      { wch: 12 }, // Stock Actual
      { wch: 12 }, // Stock Mínimo
      { wch: 10 }, // Unidad
      { wch: 10 }, // Estado
      { wch: 50 }, // URL Imagen
      { wch: 15 }, // Fecha Creación
      { wch: 18 }  // Última Actualización
    ];
    worksheet['!cols'] = colWidths;
    
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');

    // Generar nombre de archivo con fecha
    const date = new Date();
    const fileName = `productos_${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}.xlsx`;

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.send(buffer);

  } catch (err: any) {
    console.error('Error al exportar productos:', err);
    res.status(500).json({ message: err.message || 'Error al exportar productos' });
  }
});

// GET /api/products/export/csv - Exportar a CSV (alternativa)
router.get('/export/csv', async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const { search, categoryId, lowStock } = req.query;

  try {
    const where: any = { tenantId, isActive: true };
    if (search) where.name = ILike(`%${search}%`);
    if (categoryId) where.categoryId = categoryId;

    let products = await productRepo().find({
      where,
      relations: ['category'],
      order: { name: 'ASC' }
    });

    if (lowStock === 'true') {
      products = products.filter(p => Number(p.stock) <= Number(p.minStock));
    }

    // Cabeceras CSV
    const headers = [
      'Nombre', 'SKU', 'Descripción', 'Categoría', 'Precio Costo (COP)',
      'Precio Venta (COP)', 'Stock Actual', 'Stock Mínimo', 'Unidad', 'Estado'
    ];
    
    // Filas CSV
    const rows = products.map(p => [
      `"${p.name.replace(/"/g, '""')}"`,
      `"${(p.sku || '').replace(/"/g, '""')}"`,
      `"${(p.description || '').replace(/"/g, '""')}"`,
      `"${(p.category?.name || 'Sin categoría').replace(/"/g, '""')}"`,
      p.costPrice,
      p.salePrice,
      p.stock,
      p.minStock,
      p.unit === 'unit' ? 'Unidad' : p.unit,
      p.isActive ? 'Activo' : 'Inactivo'
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    
    const date = new Date();
    const fileName = `productos_${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}.csv`;
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.send('\uFEFF' + csvContent); // BOM para UTF-8

  } catch (err: any) {
    console.error('Error al exportar productos a CSV:', err);
    res.status(500).json({ message: err.message || 'Error al exportar productos' });
  }
});

export default router;