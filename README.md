# NexoAdmin — Backend

API REST para la plataforma SaaS multipropósito NexoAdmin.

## Stack
- **Node.js** + **Express** + **TypeScript**
- **PostgreSQL** + **TypeORM**
- **JWT** (access + refresh tokens)
- **Railway** (deploy)

---

## 🚀 Instalación local

```bash
# 1. Clonar e instalar dependencias
cd nexoadmin-backend
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Edita .env con tus credenciales

# 3. Asegúrate de tener PostgreSQL corriendo localmente
# O usa la URL de Railway directamente en DATABASE_URL

# 4. Correr en desarrollo (auto-reload)
npm run dev

# 5. En otro terminal, correr el seed inicial
npm run seed
```

El servidor corre en `http://localhost:3000`

---

## 🌐 Deploy en Railway

### Paso 1 — Crear proyecto
1. Ve a [railway.app](https://railway.app) → New Project
2. **Add PostgreSQL** → copia la `DATABASE_URL`
3. **Add service** → Deploy from GitHub repo

### Paso 2 — Variables de entorno en Railway
En tu servicio Node, ve a **Variables** y agrega:

```
NODE_ENV=production
DATABASE_URL=<la que te dio Railway>
JWT_SECRET=<genera uno largo y aleatorio>
JWT_REFRESH_SECRET=<otro distinto>
SUPERADMIN_EMAIL=tu@email.com
SUPERADMIN_PASSWORD=<contraseña segura>
NEQUI_NUMBER=3001234567
BANK_ACCOUNT_INFO=Bancolombia · CC 123456789 · Tu Nombre
WHATSAPP_SUPPORT=573001234567
FRONTEND_URL=https://tu-frontend.up.railway.app
```

### Paso 3 — Seed en producción
Una vez desplegado, en Railway → tu servicio → **Shell**:
```bash
npm run seed
```

---

## 📋 Endpoints principales

### Auth
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Registro + crea tenant |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/refresh` | Renovar access token |
| POST | `/api/auth/logout` | Cerrar sesión |
| GET | `/api/auth/me` | Usuario actual |

### Onboarding (wizard)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/tenants/me` | Datos del negocio |
| PATCH | `/api/tenants/me` | Actualizar negocio |
| POST | `/api/tenants/onboarding` | Guardar paso del wizard |

### Inventario
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/products` | Listar productos (`?search=&categoryId=&lowStock=true`) |
| POST | `/api/products` | Crear producto |
| PATCH | `/api/products/:id` | Actualizar producto |
| DELETE | `/api/products/:id` | Eliminar (soft delete) |
| GET | `/api/products/categories/all` | Categorías |
| POST | `/api/products/categories` | Crear categoría |

### Ventas
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/sales` | Listar ventas |
| POST | `/api/sales` | Crear venta (descuenta stock) |
| GET | `/api/sales/summary` | Resumen día / mes |

### Gastos
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/expenses` | Listar gastos |
| POST | `/api/expenses` | Crear gasto (respeta límite por plan) |
| PATCH | `/api/expenses/:id` | Actualizar |
| DELETE | `/api/expenses/:id` | Eliminar |

### Planes
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/plans` | Ver planes disponibles |
| GET | `/api/plans/my-subscription` | Mi suscripción activa |
| POST | `/api/plans/request-upgrade` | Solicitar upgrade (pago manual) |

### Admin (solo superadmin)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/admin/stats` | Estadísticas globales |
| GET | `/api/admin/tenants` | Todos los negocios |
| PATCH | `/api/admin/tenants/:id/status` | Activar/suspender tenant |
| GET | `/api/admin/subscriptions/pending` | Pagos pendientes de verificar |
| POST | `/api/admin/subscriptions/:id/activate` | Activar plan tras verificar pago |
| POST | `/api/admin/subscriptions/:id/reject` | Rechazar pago |

---

## 🔐 Roles

| Rol | Descripción |
|-----|-------------|
| `superadmin` | Tú. Acceso total a todos los tenants |
| `admin` | Dueño del negocio. Gestión completa de su tenant |
| `cashier` | Cajero. Solo ventas |
| `warehouse` | Bodega. Solo inventario |
| `supervisor` | Ve reportes, no edita |

---

## 📁 Estructura

```
src/
├── config/
│   └── data-source.ts       # TypeORM config
├── modules/
│   ├── auth/                # Login, registro, JWT
│   ├── users/               # Gestión de usuarios
│   ├── tenants/             # Multi-tenancy + onboarding
│   ├── plans/               # Planes + suscripciones
│   ├── products/            # Inventario + categorías
│   ├── expenses/            # Gastos
│   ├── sales/               # Ventas + items
│   └── admin/               # Panel superadmin
├── shared/
│   ├── middleware/
│   │   ├── auth.middleware.ts    # JWT verify + roles
│   │   └── tenant.middleware.ts  # Context tenant + módulos
│   └── utils/
│       └── jwt.utils.ts
├── database/
│   └── seeds/               # Datos iniciales
└── main.ts                  # Entry point
```
