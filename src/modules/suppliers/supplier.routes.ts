import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { Supplier } from './supplier.entity';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { resolveTenant } from '../../shared/middleware/tenant.middleware';
import { ILike } from 'typeorm';

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
    const supplier = repo().create({ ...req.body, tenantId: req.tenant!.id });
    res.status(201).json(await repo().save(supplier));
  } catch (err: any) { res.status(400).json({ message: err.message }); }
});

router.patch('/:id', async (req: Request, res: Response) => {
  const supplier = await repo().findOne({ where: { id: req.params.id, tenantId: req.tenant!.id } });
  if (!supplier) { res.status(404).json({ message: 'Proveedor no encontrado.' }); return; }
  Object.assign(supplier, req.body);
  res.json(await repo().save(supplier));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await repo().update({ id: req.params.id, tenantId: req.tenant!.id }, { isActive: false });
  res.json({ message: 'Proveedor eliminado.' });
});

export default router;