import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { AppDataSource } from '../../config/data-source';
import { Tenant } from './tenant.entity';
import { authenticate, adminOrAbove } from '../../shared/middleware/auth.middleware';
import { resolveTenant } from '../../shared/middleware/tenant.middleware';
import { upload } from '../../shared/middleware/upload.middleware';
import { v2 as cloudinary } from 'cloudinary';

const router = Router();
const tenantRepo = () => AppDataSource.getRepository(Tenant);

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Todas las rutas requieren auth
router.use(authenticate);

// GET /api/tenants/me — datos del negocio actual
router.get('/me', resolveTenant, async (req: Request, res: Response) => {
  res.json(req.tenant);
});

// PATCH /api/tenants/me — actualizar datos del negocio
router.patch('/me', adminOrAbove, resolveTenant, async (req: Request, res: Response) => {
  const allowed = [
    'businessName', 'businessType', 'logoUrl', 'phone', 'city', 'taxId',
    'primaryColor', 'accentColor', 'colorTheme',
  ];

  const updates: Partial<Tenant> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      (updates as any)[key] = req.body[key];
    }
  }

  try {
    await tenantRepo().update(req.tenant!.id, updates);
    const updated = await tenantRepo().findOne({ where: { id: req.tenant!.id } });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/tenants/onboarding — guardar paso del wizard
router.post('/onboarding',
  adminOrAbove,
  resolveTenant,
  [body('step').isInt({ min: 1, max: 6 })],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { step, data } = req.body;
    const tenant = req.tenant!;

    // Mapear cada paso a los campos que actualiza
    const stepFields: Record<number, string[]> = {
      1: ['businessType'],
      2: ['businessName', 'phone', 'city', 'taxId', 'logoUrl'],
      3: ['enabledModules'],
      4: ['primaryColor', 'accentColor', 'colorTheme'],
      5: [], // manejo de usuarios — en user.routes
      6: [], // finalizar
    };

    const allowed = stepFields[step] || [];
    const updates: Partial<Tenant> = { onboardingStep: step };

    for (const key of allowed) {
      if (data[key] !== undefined) {
        (updates as any)[key] = data[key];
      }
    }

    if (step === 6) {
      updates.onboardingCompleted = true;
    }

    try {
      await tenantRepo().update(tenant.id, updates);
      res.json({ message: `Paso ${step} guardado.`, step });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// DELETE /api/tenants/me — eliminar cuenta completa
router.delete('/me', adminOrAbove, resolveTenant, async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    await queryRunner.query(`DELETE FROM sale_items WHERE "saleId" IN (SELECT id FROM sales WHERE "tenantId" = $1)`, [tenantId]);
    await queryRunner.query(`DELETE FROM sales WHERE "tenantId" = $1`, [tenantId]);
    await queryRunner.query(`DELETE FROM expenses WHERE "tenantId" = $1`, [tenantId]);
    await queryRunner.query(`DELETE FROM products WHERE "tenantId" = $1`, [tenantId]);
    await queryRunner.query(`DELETE FROM categories WHERE "tenantId" = $1`, [tenantId]);
    await queryRunner.query(`DELETE FROM customers WHERE "tenantId" = $1`, [tenantId]);
    await queryRunner.query(`DELETE FROM suppliers WHERE "tenantId" = $1`, [tenantId]);
    await queryRunner.query(`DELETE FROM tenant_subscriptions WHERE "tenantId" = $1`, [tenantId]);
    await queryRunner.query(`DELETE FROM users WHERE "tenantId" = $1`, [tenantId]);
    await queryRunner.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await queryRunner.commitTransaction();
    res.json({ message: 'Cuenta eliminada.' });
  } catch (err: any) {
    await queryRunner.rollbackTransaction();
    res.status(500).json({ message: 'Error al eliminar la cuenta.' });
  } finally {
    await queryRunner.release();
  }
});

// POST /api/tenants/me/logo
router.post('/me/logo', adminOrAbove, resolveTenant, upload.single('logo'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ message: 'No se recibió ninguna imagen.' });
    return;
  }

  try {
    // Subir a Cloudinary desde el buffer en memoria
    const result = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `nexoadmin/logos/${req.tenant!.id}`,
          public_id: 'logo',
          overwrite: true,
          transformation: [{ width: 200, height: 200, crop: 'limit' }],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file!.buffer);
    });

    const logoUrl = result.secure_url;
    await tenantRepo().update(req.tenant!.id, { logoUrl });
    const updated = await tenantRepo().findOne({ where: { id: req.tenant!.id } });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: 'Error al subir la imagen.' });
  }
});

export default router;
