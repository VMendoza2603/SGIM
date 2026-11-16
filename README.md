# SGIM · Sistema de Gestión de Incidentes de Mantenimiento

Aplicativo web con agente inteligente integrado a WhatsApp (tesis UNEMI · Mendoza Mora / Rodríguez Zambrano).

| Carpeta | Contenido |
|---|---|
| `database/` | Scripts PostgreSQL: `01_schema.sql`, `02_seed.sql`, `03_demo.sql`, migraciones `NN_migracion_*.sql` y `setup.ps1` |
| `backend/` | API REST en Node.js + Express + TypeScript |
| `frontend/` | Panel web en React + Vite + TypeScript |
| `api/` | Punto de entrada de la API para Vercel |

> **Instalar en otra PC o desplegar en Vercel:** ver [DESPLIEGUE.md](DESPLIEGUE.md).

## Requisitos

Node.js 20 o superior y PostgreSQL 17.

## Puesta en marcha

Las claves no vienen en el repositorio: copia `backend/.env.example` y `frontend/.env.example` como `.env` y completa los valores (pásalos por USB o un medio privado, nunca por chat ni en GitHub).

1. Crear la base de datos (pide la contraseña del usuario `postgres` y genera `backend/.env`):
   ```bash
   powershell -NoProfile -ExecutionPolicy Bypass -File .\database\setup.ps1
   ```
2. Instalar dependencias y cargar los datos de demostración:
   ```bash
   cd backend && npm install && npm run db:demo
   cd ../frontend && npm install
   ```
3. Levantar todo con **un solo comando** desde la carpeta raíz (backend → túnel de WhatsApp → frontend; Ctrl + C cierra todo):
   ```bash
   npm run dev
   ```
   Sin túnel (no cambia el webhook de WhatsApp): `npm run dev:sin-tunel`. También se puede levantar cada parte por separado con `npm run dev` en `backend/` y en `frontend/`.
4. Abrir http://localhost:5173

## Usuarios de prueba

Definidos en `database/02_seed.sql`. Al primer ingreso el sistema obliga a cambiar la contraseña temporal.

| Correo | Rol |
|---|---|
| coordinador@sgim.test | Administrador / Coordinador |
| lparedes@sgim.test | Técnico (Electricidad, Iluminación, Climatización) |
| avillacis@sgim.test | Técnica (Agua, Mobiliario, Seguridad) |
| edumendoza.2031@gmail.com | **Técnico líder** (Victor Mendoza): recibe todos los reportes por WhatsApp y puede reasignarlos |

El técnico líder se crea con las migraciones `05` y `06`, que `setup.ps1` ejecuta solo.

Si la base ya existía antes de una actualización, aplica las migraciones nuevas (`database/NN_migracion_*.sql`):
```bash
cd backend && npm run db:migrar
```

Para volver al estado inicial (borra incidentes y restaura las contraseñas temporales):
```bash
cd backend && npm run db:reiniciar
```

## Recuperar contraseña en desarrollo

El envío de correos se conecta en la etapa de notificaciones. Mientras tanto, el enlace de recuperación se imprime en la consola del backend.

## Estructura del código

- `backend/src/rutas/`: una ruta por módulo del panel (incidentes, historial, infraestructura, personal, reglas…). Cada ruta valida la entrada con zod y exige su permiso.
- `backend/src/servicios/`: lógica de negocio reutilizable: motor de reglas de prioridad, asignación automática y auditoría.
- `frontend/src/paginas/`: una página por pantalla del prototipo (P01–P04, A01–A14, T01–T04).
- `frontend/src/ui.tsx`: componentes y hooks compartidos (`useCarga`, `useAccion`, `Campo`, `Interruptor`…).
- `frontend/src/styles.css`: estilos con custom properties (colores, espacios, radios) y modo oscuro; diseño responsive con grid y flexbox.
