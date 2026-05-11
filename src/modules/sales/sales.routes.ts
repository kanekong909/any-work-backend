import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { Sale, SaleItem, SaleStatus } from './sale.entity';
import { Product } from '../products/product.entity';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { resolveTenant, checkModule } from '../../shared/middleware/tenant.middleware';
// import { format } from 'date-fns';
import { Between, ILike } from 'typeorm'; 
import { logAction } from '../../shared/utils/audit'; 
import { AuditAction } from '../audit/audit-log.entity'; 
import { User } from '../users/user.entity'; 

const router = Router();
router.use(authenticate, resolveTenant, checkModule('sales'));

const saleRepo = () => AppDataSource.getRepository(Sale);
const productRepo = () => AppDataSource.getRepository(Product);
const userRepo = () => AppDataSource.getRepository(User);

// GET /api/sales
router.get('/', async (req: Request, res: Response) => {
  // Extraemos todos los posibles parámetros enviados desde el frontend (Angular)
  const { startDate, endDate, from, to, search, page = 1, limit = 20 } = req.query;
  const tenantId = req.tenant!.id;

  // Inicializamos las condiciones base del WHERE
  let whereConditions: any = { tenantId, status: SaleStatus.COMPLETED };

  // Homologación de fechas: Soporta tanto 'startDate'/'endDate' de Angular como 'from'/'to' antiguos
  const fechaDesde = (startDate || from) as string;
  const fechaHasta = (endDate || to) as string;

  if (fechaDesde && fechaHasta) {
    // Rompemos las cadenas en año, mes y día para evitar la conversión automática a UTC
    const [startYear, startMonth, startDay] = fechaDesde.split('-').map(Number);
    const [endYear, endMonth, endDay] = fechaHasta.split('-').map(Number);

    // Creamos las instancias usando el huso horario local de la máquina del servidor
    // Nota: El mes en JavaScript inicia en 0 (Enero es 0, por eso restamos 1)
    const parsedStart = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
    const parsedEnd = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);

    whereConditions.createdAt = Between(parsedStart, parsedEnd);
  }

  // --- FILTRO DE BÚSQUEDA GLOBAL ---
  if (search && (search as string).trim() !== '') {
    const cleanSearch = `%${(search as string).trim()}%`;
    
    // Convertimos las condiciones en un arreglo OR para buscar en múltiples columnas a la vez
    whereConditions = [
      { ...whereConditions, saleNumber: ILike(cleanSearch) },
      { ...whereConditions, customerName: ILike(cleanSearch) },
      { ...whereConditions, notes: ILike(cleanSearch) }
    ];
  }

  // Ejecutamos la consulta en la base de datos con paginación
  const [items, total] = await saleRepo().findAndCount({
    where: whereConditions,
    order: { createdAt: 'DESC' },
    take: Number(limit),
    skip: (Number(page) - 1) * Number(limit),
    relations: ['cashier'],
  });

  // Calculamos el total de los ingresos basado en los ítems filtrados devueltos
  const totalRevenue = items.reduce((acc, s) => acc + Number(s.total), 0);
  
  res.json({ items, total, totalRevenue, page: Number(page) });
});

// POST /api/sales — crear venta y descontar inventario
router.post('/', async (req: Request, res: Response) => {
  const { items, paymentType, customerName, notes, discount = 0 } = req.body;
  const tenantId = req.tenant!.id;

  if (!items?.length) {
    res.status(400).json({ message: 'La venta debe tener al menos un producto.' });
    return;
  }

  // Transacción: verificar stock + crear venta + actualizar inventario
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const saleItems: SaleItem[] = [];
    let subtotal = 0;

    for (const item of items) {
      const product = await queryRunner.manager.findOne(Product, {
        where: { id: item.productId, tenantId },
      });

      if (!product) throw new Error(`Producto ${item.productId} no encontrado.`);
      if (product.stock < item.quantity) {
        throw new Error(`Stock insuficiente para "${product.name}". Disponible: ${product.stock}`);
      }

      const itemSubtotal = Number(product.salePrice) * Number(item.quantity);
      subtotal += itemSubtotal;

      const saleItem = new SaleItem();
      saleItem.productId = product.id;
      saleItem.productName = product.name;
      saleItem.quantity = item.quantity;
      saleItem.unitPrice = product.salePrice;
      saleItem.subtotal = itemSubtotal;
      saleItems.push(saleItem);

      // Descontar stock
      await queryRunner.manager.update(Product, product.id, {
        stock: Number(product.stock) - Number(item.quantity),
      });
    }

    const total = subtotal - Number(discount);
    const saleNumber = `VTA-${Date.now()}`;

    const sale = new Sale();
    sale.saleNumber = saleNumber;
    sale.subtotal = subtotal;
    sale.discount = discount;
    sale.total = total;
    sale.paymentType = paymentType;
    sale.customerName = customerName;
    sale.notes = notes;
    sale.tenantId = tenantId;
    sale.cashierId = req.user!.sub;
    sale.items = saleItems;

    const saved = await queryRunner.manager.save(Sale, sale);
    
    // Confirmamos la transacción en la base de datos de manera definitiva
    await queryRunner.commitTransaction();

    // 🛡️ CONTROL SEGURO DE AUDITORÍA PARA CAJEROS
    try {
      // Intentamos extraer el nombre del token
      let cashierName = (req.user as any)?.name;
      
      // Si el cajero no tiene el nombre en su JWT, lo extraemos directamente de la BD
      if (!cashierName) {
        const userRepoInstance = AppDataSource.getRepository(User);
        const cashierUser = await userRepoInstance.findOne({ where: { id: req.user!.sub } });
        cashierName = cashierUser ? cashierUser.name : 'Cajero del negocio';
      }

      const metodosPago: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };
      const metodoLabel = metodosPago[paymentType] || paymentType;
      const clienteInfo = customerName ? ` al cliente "${customerName}"` : ' al público general';

      // Guardado físico en la tabla audit_logs
      await logAction({
        tenantId: tenantId,
        userId: req.user!.sub,
        userName: cashierName, // 👈 Pasamos el nombre verificado obtenido de la BD
        action: AuditAction.CREATE,
        module: 'sales',
        description: `Registró la venta #${saleNumber}${clienteInfo} por un valor total de $${Number(total).toLocaleString('es-CO')} (${metodoLabel}).`
      });

    } catch (auditError) {
      // Si el log falla por temas de concurrencia, no bloquea la respuesta 201 de la venta
      console.error('⚠️ Error al procesar el Log de Auditoría de la venta:', auditError);
    }

    res.status(201).json(saved);
  } catch (err: any) {
    await queryRunner.rollbackTransaction();
    res.status(400).json({ message: err.message });
  } finally {
    await queryRunner.release();
  }
});

// GET /api/sales/summary — resumen del dashboard
router.get('/summary', async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const now = new Date();

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const [todaySales, monthSales] = await Promise.all([
    saleRepo().find({
      where: { tenantId, status: SaleStatus.COMPLETED, createdAt: Between(todayStart, todayEnd) },
      select: ['total', 'createdAt'],
    }),
    saleRepo().find({
      where: { tenantId, status: SaleStatus.COMPLETED, createdAt: Between(monthStart, monthEnd) },
      select: ['total', 'createdAt'],
    }),
  ]);

  res.json({
    today: {
      count: todaySales.length,
      revenue: todaySales.reduce((a, s) => a + Number(s.total), 0),
    },
    month: {
      count: monthSales.length,
      revenue: monthSales.reduce((a, s) => a + Number(s.total), 0),
    },
  });
});

// PATCH /api/sales/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const sale = await saleRepo().findOne({
    where: { id: req.params.id, tenantId: req.tenant!.id }
  });
  if (!sale) { res.status(404).json({ message: 'Venta no encontrada.' }); return; }
  const { customerName, paymentType, notes, discount } = req.body;
  if (customerName !== undefined) sale.customerName = customerName;
  if (paymentType) sale.paymentType = paymentType;
  if (notes !== undefined) sale.notes = notes;
  if (discount !== undefined) {
    sale.discount = discount;
    sale.total = Number(sale.subtotal) - Number(discount);
  }
  res.json(await saleRepo().save(sale));
});

// DELETE /api/sales/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const sale = await saleRepo().findOne({
    where: { id: req.params.id, tenantId: req.tenant!.id }
  });
  if (!sale) { res.status(404).json({ message: 'Venta no encontrada.' }); return; }
  await AppDataSource.query(`DELETE FROM sale_items WHERE "saleId" = $1`, [sale.id]);
  await saleRepo().delete(sale.id);
  res.json({ message: 'Venta eliminada.' });
});

export default router;
