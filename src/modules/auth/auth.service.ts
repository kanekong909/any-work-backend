import bcrypt from 'bcryptjs';
import { AppDataSource } from '../../config/data-source';
import { User, UserRole } from '../users/user.entity';
import { Tenant, TenantStatus, BusinessType } from '../tenants/tenant.entity';
import { Plan } from '../plans/plan.entity';
import { TenantSubscription, SubscriptionStatus, PaymentMethod } from '../plans/tenant-subscription.entity';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../../shared/utils/jwt.utils';

interface RegisterDto {
  name: string;
  email: string;
  password: string;
  businessName: string;
  businessType?: BusinessType;
}

interface LoginDto {
  email: string;
  password: string;
}

export class AuthService {
  private userRepo = AppDataSource.getRepository(User);
  private tenantRepo = AppDataSource.getRepository(Tenant);
  private planRepo = AppDataSource.getRepository(Plan);
  private subscriptionRepo = AppDataSource.getRepository(TenantSubscription);

  async register(dto: RegisterDto) {
    // Verificar email único
    const existing = await this.userRepo.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new Error('Ya existe una cuenta con este correo.');
    }

    // Crear slug único para el tenant
    const slug = await this.generateSlug(dto.businessName);

    // Crear tenant
    const tenant = this.tenantRepo.create({
      slug,
      businessName: dto.businessName,
      businessType: dto.businessType || BusinessType.OTHER,
      status: TenantStatus.PENDING,
      enabledModules: this.getFreeModules(),
    });
    await this.tenantRepo.save(tenant);

    // Crear usuario admin del tenant
    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const user = this.userRepo.create({
      name: dto.name,
      email: dto.email.toLowerCase(),
      password: hashedPassword,
      role: UserRole.ADMIN,
      tenantId: tenant.id,
    });
    await this.userRepo.save(user);

    // Asignar plan Free automáticamente
    const freePlan = await this.planRepo.findOne({ where: { name: 'free' } });
    if (freePlan) {
      const subscription = this.subscriptionRepo.create({
        tenantId: tenant.id,
        planId: freePlan.id,
        status: SubscriptionStatus.ACTIVE,
        paymentMethod: PaymentMethod.FREE,
        activatedAt: new Date(),
        amountPaid: 0,
      });
      await this.subscriptionRepo.save(subscription);

      // Activar tenant con plan free
      tenant.status = TenantStatus.ACTIVE;
      await this.tenantRepo.save(tenant);
    }

    const tokens = this.generateTokens(user);
    return { user: this.sanitizeUser(user), tenant, ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({
      where: { email: dto.email.toLowerCase() },
      select: ['id', 'name', 'email', 'password', 'role', 'isActive', 'tenantId'],
      relations: ['tenant'],
    });

    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new Error('Credenciales incorrectas.');
    }

    if (!user.isActive) {
      throw new Error('Tu cuenta está desactivada. Contacta al administrador.');
    }

    // Actualizar último login
    user.lastLoginAt = new Date();
    const tokens = this.generateTokens(user);
    user.refreshToken = tokens.refreshToken;
    await this.userRepo.save(user);

    return {
      user: this.sanitizeUser(user),
      tenant: user.tenant,
      ...tokens,
    };
  }

  async refreshToken(token: string) {
    const payload = verifyRefreshToken(token);
    const user = await this.userRepo.findOne({
      where: { id: payload.sub, refreshToken: token },
    });

    if (!user) throw new Error('Refresh token inválido.');

    const tokens = this.generateTokens(user);
    user.refreshToken = tokens.refreshToken;
    await this.userRepo.save(user);

    return tokens;
  }

  async logout(userId: string) {
    await this.userRepo.update(userId, { refreshToken: undefined });
  }

  // ── Helpers ──────────────────────────────────────────────────

  private generateTokens(user: User) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId ?? undefined,
    };
    return {
      accessToken: generateAccessToken(payload),
      refreshToken: generateRefreshToken(payload),
    };
  }

  private sanitizeUser(user: User) {
    const { password, refreshToken, ...safe } = user as any;
    return safe;
  }

  private getFreeModules(): Record<string, boolean> {
    return {
      dashboard: true,
      inventory: true,
      sales: true,
      expenses: true,   // limitado a 50/mes por lógica de negocio
      customers: false,
      suppliers: false,
      reports: false,
    };
  }

  private async generateSlug(businessName: string): Promise<string> {
    const base = businessName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    let slug = base;
    let counter = 1;
    while (await this.tenantRepo.findOne({ where: { slug } })) {
      slug = `${base}-${counter++}`;
    }
    return slug;
  }
}
