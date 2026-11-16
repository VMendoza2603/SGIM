# SGIM · Instalación en otra PC y despliegue en Vercel

## A. Instalar en otra PC (local)

Requisitos: Node.js 20+, PostgreSQL 17 y (para el chatbot en local) cloudflared.

1. Copiar la carpeta del proyecto **sin** `node_modules`.
2. Crear la base (pide la contraseña de `postgres` y genera `backend/.env` con DATABASE_URL, PORT y JWT_SECRET):
   ```bash
   powershell -NoProfile -ExecutionPolicy Bypass -File .\database\setup.ps1
   ```
   Ejecuta `01_schema` → `02_seed` → migraciones `04`, `05` (técnico líder) y `06` (técnico líder real).
3. Agregar a `backend/.env` las claves de WhatsApp y Gemini (copiarlas del `.env` de la PC original **por USB o un medio privado, nunca por chat**):
   `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_VERIFY_TOKEN`, `WA_APP_SECRET`, `WA_APP_ID`, `GEMINI_API_KEY`.
   Y en `frontend/.env`: `VITE_WHATSAPP_NUMERO=593980934394`.
4. Dependencias y datos de ejemplo:
   ```bash
   cd backend && npm install && npm run db:demo
   cd ../frontend && npm install
   ```
5. Levantar todo desde la carpeta raíz con **`npm run dev`** (backend → túnel → frontend, Ctrl + C cierra todo) → http://localhost:5173. Sin túnel: `npm run dev:sin-tunel`.

**Usuarios** (contraseña temporal en `database/02_seed.sql`; se cambia en el primer ingreso):

| Correo | Rol |
|---|---|
| coordinador@sgim.test | Coordinador |
| edumendoza.2031@gmail.com | Técnico **líder** (Victor Mendoza, 0979838115) |
| lparedes@sgim.test · avillacis@sgim.test | Técnicos de ejemplo (números ficticios) |

---

## B. Desplegar en Vercel (costo cero)

Arquitectura en producción: **Vercel** sirve el panel (React) y la API (Express como función serverless en `api/index.js`),
**Neon** guarda la base PostgreSQL y **Vercel Blob** guarda las fotos. El webhook de WhatsApp apunta a `https://<app>.vercel.app/api/whatsapp/webhook`, sin túnel.

### 1. Base de datos en Neon
1. Crear cuenta gratis en https://neon.tech → **New project** (región: *AWS US East*, la más cercana a Vercel).
2. En **Connection string** copiar la cadena (`postgresql://…neon.tech/neondb?sslmode=require`).
3. Desde `backend/` en PowerShell, instalar la base en Neon:
   ```powershell
   $env:DATABASE_URL = "pega-aqui-la-cadena-de-neon"
   npm run db:instalar -- --demo
   Remove-Item Env:DATABASE_URL
   ```
   (Crea las tablas, los datos base, el técnico líder real; `--demo` agrega los incidentes de ejemplo. Deja fijo el `search_path`.)

### 2. Proyecto en Vercel
1. Crear cuenta gratis en https://vercel.com (con GitHub o correo).
2. Desde la carpeta raíz del proyecto:
   ```bash
   npx vercel@65.9.0 login
   ```
   ```bash
   npx vercel@65.9.0 link
   ```
   (Responder: crear un proyecto nuevo, nombre por ejemplo `sgim`, directorio `./`. **No** cambiar los comandos: ya están en `vercel.json`.)
3. Subir las variables de entorno (las lee de los `.env`, pide la cadena de Neon, genera JWT_SECRET y CRON_SECRET nuevos):
   ```bash
   powershell -NoProfile -ExecutionPolicy Bypass -File .\vercel-variables.ps1
   ```
4. Fotos: en el panel de Vercel → proyecto `sgim` → **Storage** → **Create** → **Blob** → conectarlo al proyecto (agrega `BLOB_READ_WRITE_TOKEN` solo).
5. Publicar:
   ```bash
   npx vercel@65.9.0 --prod
   ```
   Al terminar muestra la dirección, por ejemplo `https://sgim.vercel.app`. Abrirla e ingresar con el coordinador.

### 3. WhatsApp apuntando a Vercel
Desde `backend/` (usa las claves de `backend/.env`):
```bash
npm run webhook:produccion -- https://sgim.vercel.app
```
Comprueba que Vercel responda y registra la URL en la app de Meta y en el número. Desde ahí el bot responde aunque tu PC esté apagada.
(Si después corres `npm run tunel` en local, el número vuelve a apuntar al túnel; repite este paso para regresar a Vercel.)

### 4. Reintentos de avisos (opcional, recomendado)
Los avisos salen al instante; si alguno falla por algo pasajero, se reintenta llamando a `/api/cron/notificaciones`.
En https://cron-job.org (gratis) crear un trabajo cada 5 minutos:
- URL: `https://sgim.vercel.app/api/cron/notificaciones`
- Encabezado: `Authorization: Bearer <CRON_SECRET>` (el valor quedó en `backend/.env` como `CRON_SECRET`).

### Diferencias con la versión local
| | Local | Vercel |
|---|---|---|
| Base | PostgreSQL de la PC | Neon |
| Fotos | `backend/uploads/` | Vercel Blob |
| Webhook | túnel cloudflared (`npm run tunel`) | URL fija de Vercel |
| Avisos de WhatsApp | al instante + cada 15 s | al instante + cron externo |
| Procesamiento del webhook | en segundo plano | `waitUntil` (la función sigue viva hasta terminar, máx. 60 s) |

Límites del plan gratuito a tener en cuenta: 4,5 MB por petición (el panel reduce las fotos antes de subirlas),
60 s por función, Neon 0,5 GB y Vercel Blob 1 GB. Los datos de la PC local **no** pasan solos a Neon: la base de producción empieza con los datos base y la demo.
