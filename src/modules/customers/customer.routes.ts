import { Router, Request, Response } from 'express';
import { AppDataSource } from '../../config/data-source';
import { Customer } from './customer.entity';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { resolveTenant } from '../../shared/middleware/tenant.middleware';
import { ILike } from 'typeorm';

const router = Router();
router.use(authenticate, resolveTenant);

const repo = () => AppDataSource.getRepository(Customer);

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
    const customer = repo().create({ ...req.body, tenantId: req.tenant!.id });
    res.status(201).json(await repo().save(customer));
  } catch (err: any) { res.status(400).json({ message: err.message }); }
});

router.patch('/:id', async (req: Request, res: Response) => {
  const customer = await repo().findOne({ where: { id: req.params.id, tenantId: req.tenant!.id } });
  if (!customer) { res.status(404).json({ message: 'Cliente no encontrado.' }); return; }
  Object.assign(customer, req.body);
  res.json(await repo().save(customer));
});

router.delete('/:id', async (req: Request, res: Response) => {
  await repo().update({ id: req.params.id, tenantId: req.tenant!.id }, { isActive: false });
  res.json({ message: 'Cliente eliminado.' });
});

export default router;