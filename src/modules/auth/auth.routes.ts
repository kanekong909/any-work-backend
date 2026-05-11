import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { AuthService } from './auth.service';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { AppDataSource } from '../../config/data-source';
import { User } from '../users/user.entity';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
const router = Router();
const authService = new AuthService();

// ── Validaciones ───────────────────────────────────────────────
const registerValidation = [
  body('name').trim().notEmpty().withMessage('El nombre es requerido.'),
  body('email').isEmail().withMessage('Correo inválido.').normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres.')
    .matches(/[A-Z]/).withMessage('Debe contener al menos una mayúscula.')
    .matches(/[0-9]/).withMessage('Debe contener al menos un número.'),
  body('businessName').trim().notEmpty().withMessage('El nombre del negocio es requerido.'),
];

const loginValidation = [
  body('email').isEmail().withMessage('Correo inválido.').normalizeEmail(),
  body('password').notEmpty().withMessage('La contraseña es requerida.'),
];

// ── Handlers ───────────────────────────────────────────────────

// POST /api/auth/register
router.post('/register', registerValidation, async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const result = await authService.register(req.body);
    res.status(201).json({ message: '¡Cuenta creada exitosamente!', ...result });
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

// POST /api/auth/login
router.post('/login', loginValidation, async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const result = await authService.login(req.body);
    res.json({ message: 'Inicio de sesión exitoso.', ...result });
  } catch (err: any) {
    res.status(401).json({ message: err.message });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).json({ message: 'Refresh token requerido.' });
    return;
  }

  try {
    const tokens = await authService.refreshToken(refreshToken);
    res.json(tokens);
  } catch {
    res.status(401).json({ message: 'Refresh token inválido o expirado.' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    await authService.logout(req.user!.sub);
    res.json({ message: 'Sesión cerrada.' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: Request, res: Response) => {
  res.json({ user: req.user });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) { res.status(400).json({ message: 'El correo es requerido.' }); return; }

  const userRepo = AppDataSource.getRepository(User);
  const user = await userRepo.findOne({ where: { email: email.toLowerCase() } });

  // Siempre responder igual para no revelar si el email existe
  const genericResponse = { message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' };

  if (!user) { res.json(genericResponse); return; }

  // Generar token único de 1 hora
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

  user.refreshToken = `reset:${token}:${expires.getTime()}`;
  await userRepo.save(user);

  // Enviar email
  const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password?token=${token}&email=${email}`;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Restablecer contraseña — NexoAdmin',
      html: `
        <div style="font-family: Inter, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
          <h2 style="color: #0f172a;">Restablecer tu contraseña</h2>
          <p style="color: #64748b;">Haz clic en el botón para crear una nueva contraseña. Este enlace expira en 1 hora.</p>
          <a href="${resetUrl}" style="display: inline-block; background: #6366f1; color: white;
            padding: 0.875rem 1.5rem; border-radius: 10px; text-decoration: none;
            font-weight: 600; margin: 1rem 0;">Restablecer contraseña</a>
          <p style="color: #94a3b8; font-size: 0.8rem;">Si no solicitaste esto, ignora este correo.</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('Error enviando email:', err);
  }

  res.json(genericResponse);
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req: Request, res: Response) => {
  const { email, token, newPassword } = req.body;
  if (!email || !token || !newPassword) {
    res.status(400).json({ message: 'Datos incompletos.' }); return;
  }

  const userRepo = AppDataSource.getRepository(User);
  const user = await userRepo.findOne({
    where: { email: email.toLowerCase() },
    select: ['id', 'refreshToken', 'password'],
  });

  if (!user?.refreshToken?.startsWith('reset:')) {
    res.status(400).json({ message: 'Token inválido o expirado.' }); return;
  }

  const parts = user.refreshToken.split(':');
  const savedToken = parts[1];
  const expires = Number(parts[2]);

  if (savedToken !== token || Date.now() > expires) {
    res.status(400).json({ message: 'El enlace ha expirado. Solicita uno nuevo.' }); return;
  }

  user.password = await bcrypt.hash(newPassword, 12);
  user.refreshToken = '';
  await userRepo.save(user);

  res.json({ message: '¡Contraseña actualizada! Ya puedes iniciar sesión.' });
});

export default router;
