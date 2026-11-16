import cors from 'cors';
import express from 'express';
import { autenticar, exigeContrasenaDefinitiva } from './auth.js';
import { config, whatsappActivo } from './config.js';
import { manejadorErrores } from './errores.js';
import { alertasRouter } from './rutas/alertas.js';
import { auditoriaRouter } from './rutas/auditoria.js';
import { authRouter } from './rutas/auth.js';
import { catalogosRouter } from './rutas/catalogos.js';
import { configuracionRouter } from './rutas/configuracion.js';
import { conversacionesRouter } from './rutas/conversaciones.js';
import { dashboardRouter } from './rutas/dashboard.js';
import { historialRouter } from './rutas/historial.js';
import { DIR_UPLOADS, incidentesRouter } from './rutas/incidentes.js';
import { infraestructuraRouter } from './rutas/infraestructura.js';
import { perfilRouter } from './rutas/perfil.js';
import { personalRouter } from './rutas/personal.js';
import { reglasRouter } from './rutas/reglas.js';
import { reportesRouter } from './rutas/reportes.js';
import { verificacionesRouter } from './rutas/verificaciones.js';
import { whatsappRouter } from './rutas/whatsapp.js';
import { despacharPendientes } from './servicios/notificaciones.js';
import { enSegundoPlano } from './servicios/segundoPlano.js';

export const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: config.frontendOrigin }));
// Se guarda el cuerpo crudo para verificar la firma de los webhooks de Meta
app.use(express.json({ limit: '8mb', verify: (req, _res, buf) => ((req as express.Request & { rawBody?: Buffer }).rawBody = buf) }));
app.use('/uploads', express.static(DIR_UPLOADS));

app.get('/api/salud', (_req, res) => res.json({ ok: true }));

// Avisos de WhatsApp en cola: salen apenas termina la operación que los generó (asignar, cambiar estado…).
// En Vercel no hay setInterval: esto reemplaza al despacho periódico; los reintentos los hace /api/cron/notificaciones.
app.use((req, res, next) => {
  if (whatsappActivo() && req.method !== 'GET' && req.path.startsWith('/api/') && !req.path.startsWith('/api/whatsapp')) {
    enSegundoPlano(new Promise<void>((listo) => res.on('finish', () => listo())).then(() => despacharPendientes()));
  }
  next();
});

/**
 * Reintentos de avisos fallidos (cada 2 y 4 min). Lo llama un cron externo gratuito (cron-job.org, cada 5 min)
 * o el cron de Vercel, con el encabezado `Authorization: Bearer <CRON_SECRET>`.
 */
app.get('/api/cron/notificaciones', async (req, res) => {
  if (!config.cronSecret || req.headers.authorization !== `Bearer ${config.cronSecret}`) return res.sendStatus(401);
  await despacharPendientes();
  res.json({ ok: true });
});
app.use('/api/auth', authRouter);
app.use('/api/whatsapp', whatsappRouter); // webhook público de Meta (verifica firma)

// Todo lo demás exige sesión y contraseña definitiva
app.use('/api', autenticar, exigeContrasenaDefinitiva);
app.use('/api/catalogos', catalogosRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/alertas', alertasRouter);
app.use('/api/incidentes', incidentesRouter);
app.use('/api/verificaciones', verificacionesRouter);
app.use('/api/historial', historialRouter);
app.use('/api/infraestructura', infraestructuraRouter);
app.use('/api/personal', personalRouter);
app.use('/api/reglas', reglasRouter);
app.use('/api/conversaciones', conversacionesRouter);
app.use('/api/reportes', reportesRouter);
app.use('/api/configuracion', configuracionRouter);
app.use('/api/auditoria', auditoriaRouter);
app.use('/api/perfil', perfilRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use(manejadorErrores);
