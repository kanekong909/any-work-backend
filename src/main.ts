process.env.TZ = 'America/Bogota';
import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { AppDataSource } from './config/data-source';

// Rutas
import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/users/user.routes';
import tenantRoutes from './modules/tenants/tenant.routes';
import planRoutes from './modules/plans/plan.routes';
import productRoutes from './modules/products/product.routes';
import expenseRoutes from './modules/expenses/expense.routes';
import salesRoutes from './modules/sales/sales.routes';
import adminRoutes from './modules/admin/admin.routes';
import customerRoutes from './modules/customers/customer.routes';
import supplierRoutes from './modules/suppliers/supplier.routes';
import reportRoutes from './modules/reports/report.routes';
import auditRoutes from './modules/audit/audit.routes';
import boldRoutes from './modules/payments/bold.routes';
import receiptRoutes from './modules/suppliers/receipt.routes';

dotenv.config();

const app = express();
// Confiar en el proxy de Railway (1 nivel)
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ── Seguridad ──────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  credentials: true,
}));

// Rate limiting global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 200,
  message: { message: 'Demasiadas solicitudes, intenta más tarde.' },
}));

// Rate limiting estricto para auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Demasiados intentos de autenticación.' },
});

// ── Middleware ─────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Rutas ──────────────────────────────────────────────────────
app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/products', productRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/payments', boldRoutes);
app.use('/api/receipts', receiptRoutes);

// ── 404 ────────────────────────────────────────────────────────
app.use((_, res) => {
  res.status(404).json({ message: 'Ruta no encontrada.' });
});

// ── Error global ───────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error no manejado:', err);
  res.status(500).json({
    message: process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor.'
      : err.message,
  });
});

// ── Inicializar DB y servidor ──────────────────────────────────
AppDataSource.initialize()
  .then(async () => {
    console.log('✅ Base de datos conectada');
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
      console.log(`📋 Entorno: ${process.env.NODE_ENV}`);
    });
  })
  .catch((err) => {
    console.error('❌ Error conectando a la base de datos:', err);
    process.exit(1);
  });

export default app;
