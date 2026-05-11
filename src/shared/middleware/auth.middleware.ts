import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../utils/jwt.utils';

// Extendemos Request para incluir el usuario autenticado
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Token de acceso requerido.' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: 'Token inválido o expirado.' });
  }
};

// Middleware para verificar roles
export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'No autenticado.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: 'No tienes permiso para esta acción.' });
      return;
    }
    next();
  };
};

// Solo superadmin
export const superadminOnly = authorize('superadmin');

// Admin o superadmin
export const adminOrAbove = authorize('superadmin', 'admin');
