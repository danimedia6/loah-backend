# SantaPalma Backend

API REST para Gastrobar SantaPalma — servidor Node.js + Express (ES modules) usando Supabase como base de datos y autenticación.

## Contenido
- [Descripción](#descripción)
- [Arquitectura](#arquitectura)
- [Requisitos](#requisitos)
- [Instalación y ejecución](#instalación-y-ejecución-local)
- [Variables de entorno](#variables-de-entorno-mínimas)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Testing](#testing)
- [Endpoints principales](#endpoints-principales-resumen)
- [Autenticación y roles](#autenticación-y-roles)
- [Módulos](#módulos)

## Descripción
Este repositorio contiene el backend para la aplicación de SantaPalma. Proporciona recursos para gestionar: usuarios, productos, categorías, pedidos, mesas, pagos y auditoría.

El backend está diseñado para soportar dos tipos de usuarios principales:
- **cliente**: puede registrarse públicamente y usar la app cliente para ver productos y realizar pedidos.
- **admin**: gestiona productos, categorías, pedidos, mesas y usuarios desde el panel administrativo.

## Arquitectura
El proyecto sigue una **Arquitectura por Capas** para asegurar la separación de responsabilidades, mantenibilidad y testabilidad:

1.  **Routes (`src/routes/`)**: Definen los endpoints y aplican middlewares (autenticación, validación).
2.  **Controllers (`src/controllers/`)**: Manejan la petición HTTP, extraen datos y llaman a los servicios.
3.  **Services (`src/services/`)**: Contienen la lógica de negocio pura. No saben de HTTP (req/res).
4.  **Repositories (`src/repositories/`)**: Encapsulan el acceso a datos (Supabase).
5.  **Schemas (`src/schemas/`)**: Definiciones de validación con Joi.

## Requisitos
- Node.js 18+ (recomendado)
- npm
- Cuenta y proyecto en Supabase (URL + API KEY)

## Instalación y ejecución (local)
1. Clona el repositorio y entra al directorio:

```powershell
cd "C:\ruta\a\SantaPalma-Backend"
```

2. Instala dependencias:

```powershell
npm install
```

3. Crea un fichero `.env` en la raíz con las variables indicadas abajo.

4. Ejecuta en modo desarrollo:

```powershell
npm run dev
```

El servidor por defecto corre en el puerto `4000`.

## Variables de entorno (mínimas)
Coloca estas variables en tu `.env`:

```env
SUPABASE_URL=<your-supabase-url>
SUPABASE_KEY=<your-supabase-key>
JWT_SECRET=<una-cadena-secreta-larga-para-firmar-jwt>
CLIENT_URL=http://localhost:5173
PORT=4000
NODE_ENV=production
ENABLE_DEBUG_ROUTES=false
WOMPI_PUB_KEY=<wompi-public-key>
WOMPI_PRV_KEY=<wompi-private-key>
WOMPI_INTEGRITY_SECRET=<wompi-integrity-secret>
WOMPI_EVENT_SECRET=<wompi-event-secret>
```

`JWT_SECRET` no tiene fallback: debe ser una clave aleatoria de al menos 32 bytes,
sin espacios al inicio/final. Un valor ausente o invalido impide el arranque antes
de inicializar clientes, sockets o tareas. No uses literalmente los placeholders.
En Render, verifica en Environment la presencia de `JWT_SECRET`, `SUPABASE_URL`,
`SUPABASE_KEY`, `NODE_ENV=production` y los origenes `CLIENT_URL`/`CLIENT_URLS`;
no imprimas ni compartas sus valores secretos. Guarda y vuelve a desplegar.
No cambies una clave ya segura: rotarla invalida los JWT existentes.
Los logs de arranque solo indican configuracion invalida, nunca el valor.
Consulta [el informe de seguridad 0.3](backend/tests/AUTH_SECURITY.md) para limites y pruebas.

## Estructura del Proyecto

```
backend/
├── src/
│   ├── config/         # Configuración (Supabase client)
│   ├── controllers/    # Controladores (HTTP handlers)
│   ├── middlewares/    # Middlewares (Auth, ErrorHandler, Upload, Validate)
│   ├── repositories/   # Acceso a datos (Supabase queries)
│   ├── routes/         # Definición de rutas Express
│   ├── schemas/        # Esquemas de validación Joi
│   ├── services/       # Lógica de negocio
│   ├── utils/          # Utilidades (cálculos, formateo)
│   └── server.js       # Punto de entrada
├── tests/              # Tests unitarios (Jest)
└── scripts/            # Scripts de utilidad/migración
```

## Testing
El proyecto utiliza **Jest** para pruebas unitarias. Los tests están ubicados en `backend/tests/`.

Para ejecutar todos los tests:
```powershell
npm test
```

## Endpoints principales (Referencia API)

### Autenticación (`/api/auth`)
| Método | Endpoint | Descripción | Auth | Body |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/signup` | Registrar un nuevo cliente | Público | `{ nombre, correo, contrasena }` |
| `POST` | `/login` | Iniciar sesión | Público | `{ correo, contrasena }` |
| `GET` | `/me` | Obtener datos del usuario actual | Token | - |

### Usuarios (`/api/usuarios`)
| Método | Endpoint | Descripción | Auth | Body |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | Listar todos los usuarios | Admin | - |
| `GET` | `/:id` | Obtener detalle de usuario | Propietario o admin | - |
| `POST` | `/` | Registrar cliente | Público | `{ nombre, correo, contrasena, rol?: "cliente" }` |
| `PUT` | `/:id` | Actualizar campos permitidos | Propietario o admin | `{ nombre?, correo?, contrasena?, currentPassword? }` |
| `DELETE` | `/:id` | Eliminación temporalmente no disponible (409) | Propietario o admin | - |
> Los campos privilegiados se rechazan. Para cambiar la contraseña propia se exige `currentPassword`; un admin puede restablecer la de otra cuenta. Los cambios de rol solo se permiten en la ruta administrativa dedicada. Las respuestas de usuario usan una lista explícita de campos y no incluyen credenciales.

El DELETE mantiene autenticación y autorización: sin token devuelve 401; un cliente
que solicita eliminar otra cuenta recibe 403. Para el propietario o un admin
devuelve 409 con `{ error, code: "ACCOUNT_DELETION_UNAVAILABLE" }`, sin consultar
la existencia de la cuenta ni ejecutar un borrado. No desactiva la cuenta ni
simula éxito. Las solicitudes legítimas deben canalizarse a soporte mientras se
implementa desactivación, resolución de obligaciones y eliminación controlada.

El único consumidor de `usuarioService.deleteUsuario` es el controlador de
usuarios. El método destructivo `usuarioRepository.delete` queda sin consumidores
en el backend; se conserva como operación de bajo nivel, fuera del flujo HTTP.
La creación interna de usuarios es un método privado `#createUsuario`; solo el
registro validado y la creación administrativa autorizada pueden invocarlo.

#### Compatibilidad pendiente: panel heredado de empleados

`Account.jsx` carga pedidos y consulta `/api/usuarios/:id` para enriquecerlos. Usa
el nombre para mostrar y buscar pedidos; el correo se muestra solo si existe y
no es necesario para ese flujo. `pedidoRepository.findAll/findById` devuelve
`id_cliente`, pero no el nombre; el servicio solo enriquece productos. No se
restaura el acceso de empleados a cuentas ajenas.

Tarea de compatibilidad pendiente, fuera del Bloque 0.1:

- Dependencia: definir roles operativos válidos y autorizar cada pedido y listado
  contra el establecimiento asignado al actor autenticado. Las consultas actuales
  de pedidos no aplican ese aislamiento; primero debe verificarse su relación real
  con el venue. No confiar en un `venue_id` arbitrario del cliente.
- Contrato mínimo propuesto: añadir `cliente: { nombre }` a cada pedido autorizado,
  preservando los campos actuales y sin correo, teléfono ni un nuevo endpoint
  general de usuarios. No implementado en este paquete.
- Criterio de aceptación: el empleado autorizado puede mostrar y buscar por nombre
  únicamente pedidos de su venue; un actor ajeno no obtiene pedidos ni identidades;
  `/api/usuarios/:id` sigue devolviendo 403 para cuentas ajenas de empleados.
- Seguimiento frontend: consumir el nombre del pedido y retirar el enriquecimiento
  mediante usuarios. Hasta entonces pueden seguir apareciendo 403 capturados y el
  texto genérico "Cliente". No se modificó frontend ni pedidos en este paquete.

### Admin (`/api/admin`)
| Método | Endpoint | Descripción | Auth | Body |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/create` | Crear otro administrador | Admin | `{ nombre, correo, contrasena }` |
| `PUT` | `/users/:id/role` | Cambiar rol de usuario | Admin | `{ rol }` |

### Productos (`/api/productos`)
| Método | Endpoint | Descripción | Auth | Body |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | Listar productos (filtros: `page`, `limit`, `category`, `search`) | Token | - |
| `GET` | `/:id` | Obtener producto por ID | Público | - |
| `POST` | `/` | Crear producto | Admin | `multipart/form-data` (incluye `image`) |
| `PUT` | `/:id` | Actualizar producto | Admin | `multipart/form-data` |
| `DELETE` | `/:id` | Eliminar producto | Admin | - |
| `POST` | `/:id/calificacion` | Calificar producto | Token | `{ puntuacion, comentario }` |
| `GET` | `/:id/comentarios` | Ver comentarios | Público | - |

### Categorías (`/api/categorias`)
| Método | Endpoint | Descripción | Auth | Body |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | Listar categorías | Público | - |
| `GET` | `/:id` | Obtener categoría | Público | - |
| `POST` | `/` | Crear categoría | Admin | `{ nombre, descripcion }` |
| `PUT` | `/:id` | Actualizar categoría | Admin | `{ nombre, descripcion }` |
| `DELETE` | `/:id` | Eliminar categoría | Admin | - |

### Mesas (`/api/mesas`)
| Método | Endpoint | Descripción | Auth | Body |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | Listar mesas | Público | - |
| `GET` | `/:id` | Obtener mesa | Público | - |
| `POST` | `/` | Crear mesa | Token | `{ numero, capacidad, ubicacion }` |
| `PUT` | `/:id` | Actualizar mesa | Token | `{ numero, capacidad, ubicacion }` |
| `DELETE` | `/:id` | Eliminar mesa | Token | - |
| `POST` | `/:id/generate-qr` | Generar QR (PNG/PDF) | Admin | Query: `?format=pdf` |

### Pedidos (`/api/pedidos`)
| Método | Endpoint | Descripción | Auth | Body |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | Listar todos los pedidos | Staff/Admin | - |
| `GET` | `/cliente/mis-pedidos` | Ver mis pedidos | Token | - |
| `GET` | `/:id` | Ver detalle de pedido | Token | - |
| `POST` | `/` | Crear pedido | Token | `{ id_mesa, items: [{id_producto, cantidad}] }` |
| `PUT` | `/:id` | Modificar pedido | Token | `{ items, estado }` |
| `DELETE` | `/:id` | Cancelar/Eliminar pedido | Staff/Admin | - |
| `PATCH` | `/:id/estado` | Cambiar estado (pendiente -> preparando...) | Staff/Admin | `{ estado }` |
| `PATCH` | `/:id/mesa` | Cambiar mesa de pedido | Staff/Admin | `{ id_mesa }` |
| `PATCH` | `/:id/pago` | Actualizar estado de pago | Staff/Admin | `{ pago: 'pagado' }` |

### Pagos (`/api/pagos`)
**Bloque 0.4:** los pagos heredados estan contenidos. Crear cobros, modificar
pagos, editar/eliminar pedidos por la ruta generica y procesar efectos de
webhooks devuelve `503 LEGACY_PAYMENTS_UNAVAILABLE`. No usar estas rutas para
cobros reales. Los Gifts mantienen la suspension del Bloque 0.2.
Ver [informe de seguridad 0.4](backend/tests/HARDENING_SECURITY.md) para contratos,
limites, proxy de Render y requisitos antes de volver a habilitar pagos.

| Método | Endpoint | Descripción | Auth | Body |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/create` | Suspendido: `503 LEGACY_PAYMENTS_UNAVAILABLE` | Token | `{ id_pedido }` |
| `POST` | `/webhooks/wompi` | Webhook de Wompi | Público | (Payload de Wompi) |

### Auditoría (`/api/auditoria`)
| Método | Endpoint | Descripción | Auth | Body |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | Ver historial de eventos | Admin | Query: `page`, `limit`, `id_pedido` |

### Debug (`/api/debug`)
No se monta en produccion, test ni entornos ausentes/desconocidos.
Solo se monta con `NODE_ENV=development` y `ENABLE_DEBUG_ROUTES=true`.
Incluso entonces requiere conexion local directa, JWT y admin vigente.
Los dos endpoints heredados de pedidos responden `410`: no leen ni escriben pedidos.

## Autenticación y roles
- El proyecto usa JWT firmado con `JWT_SECRET`.
- Firma y expiracion (8 horas) conservadas. HTTP y Socket.IO consultan la cuenta
  actual y rechazan cuentas inexistentes/suspendidas; los permisos no proceden
  del rol ni venue historicos del token. Fallos de autorizacion en almacenamiento: `503`.
- La autenticacion opcional permite ausencia de credenciales, no credenciales
  invalidas: un token invalido/expirado responde `401`, una cuenta suspendida `403`.
- No se implemento revocacion completa de sesiones; ver el informe 0.3.
- Header requerido para rutas protegidas: `Authorization: Bearer <token>`.
- Roles soportados: `admin`, `cliente`, `mesero`.

## Módulos
- **Auth**: Gestión de registro y login.
- **Usuarios**: Gestión de perfiles y roles.
- **Productos/Categorías**: Catálogo del menú.
- **Mesas**: Gestión de mesas y códigos QR.
- **Pedidos**: Ciclo de vida del pedido (pendiente -> preparando -> listo -> entregado).
- **Pagos**: Integración con pasarela de pagos (Wompi).
- **Auditoria**: Registro de eventos críticos del sistema.
