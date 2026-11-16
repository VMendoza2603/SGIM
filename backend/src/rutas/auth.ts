import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { autenticar, cargarUsuario, firmarToken } from '../auth.js';
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { HttpError, ruta } from '../errores.js';

export const authRouter = Router();

async function parametroInt(clave: string, porDefecto: number) {
  const p = await queryOne<{ valor: string }>(`SELECT valor FROM parametro_sistema WHERE clave = $1`, [clave]);
  return p ? Number(p.valor) : porDefecto;
}

const loginSchema = z.object({ correo: z.string().trim().min(1), password: z.string().min(1) });

authRouter.post(
  '/login',
  ruta(async (req, res) => {
    const { correo, password } = loginSchema.parse(req.body);
    const u = await queryOne(
      `SELECT u.id_usuario, u.password_hash, u.activo, u.intentos_fallidos, u.bloqueado_hasta, r.acceso_web
         FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
        WHERE u.correo = $1`,
      [correo],
    );
    const auditar = (accion: string, idUsuario: number | null) =>
      query(`INSERT INTO auditoria (id_usuario, accion, datos_nuevos, ip) VALUES ($1, $2, $3, $4)`, [
        idUsuario,
        accion,
        JSON.stringify({ correo }),
        req.ip ?? null,
      ]);

    if (u && !u.acceso_web) {
      throw new HttpError(403, 'Los estudiantes, docentes y personal administrativo reportan por WhatsApp; no necesitan cuenta en el panel');
    }
    if (u?.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
      const minutos = Math.ceil((new Date(u.bloqueado_hasta).getTime() - Date.now()) / 60000);
      throw new HttpError(423, `Cuenta bloqueada por intentos fallidos. Intenta de nuevo en ${minutos} min`);
    }
    const ok = !!u && u.activo && !!u.password_hash && (await bcrypt.compare(password, u.password_hash));
    if (!ok) {
      await auditar('LOGIN_FALLIDO', u?.id_usuario ?? null);
      if (u) {
        const max = await parametroInt('seguridad.max_intentos_login', 5);
        const bloqueo = await parametroInt('seguridad.minutos_bloqueo', 15);
        const intentos = u.intentos_fallidos + 1;
        if (intentos >= max) {
          await query(
            `UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = now() + make_interval(mins => $2) WHERE id_usuario = $1`,
            [u.id_usuario, bloqueo],
          );
          throw new HttpError(423, `Cuenta bloqueada ${bloqueo} minutos por intentos fallidos`);
        }
        await query(`UPDATE usuario SET intentos_fallidos = $2 WHERE id_usuario = $1`, [u.id_usuario, intentos]);
        throw new HttpError(
          401,
          `Correo o contraseña incorrectos. Te quedan ${max - intentos} intentos antes de que la cuenta se bloquee ${bloqueo} minutos.`,
        );
      }
      throw new HttpError(401, 'Correo o contraseña incorrectos.');
    }

    await query(
      `UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now() WHERE id_usuario = $1`,
      [u.id_usuario],
    );
    await auditar('LOGIN', u.id_usuario);
    res.json({ token: firmarToken(u.id_usuario), usuario: await cargarUsuario(u.id_usuario) });
  }),
);

authRouter.get(
  '/me',
  autenticar,
  ruta(async (req, res) => res.json(req.usuario)),
);

/** Política de contraseñas (P03). Se reutiliza en cambio, restablecimiento y alta de usuarios. */
export const contrasenaSegura = z
  .string()
  .min(8, 'Mínimo 8 caracteres')
  .regex(/[A-Z]/, 'Debe tener una mayúscula')
  .regex(/[0-9]/, 'Debe tener un número')
  .regex(/[^A-Za-z0-9]/, 'Debe tener un símbolo');

const cambioSchema = z.object({ actual: z.string().min(1), nueva: contrasenaSegura });

/** Guarda la contraseña y revoca los tokens anteriores; devuelve un token nuevo para la sesión actual. */
async function fijarContrasena(idUsuario: number, nueva: string, accion: string) {
  const hash = await bcrypt.hash(nueva, 12);
  await query(
    `UPDATE usuario SET password_hash = $2, debe_cambiar_pwd = FALSE, intentos_fallidos = 0, bloqueado_hasta = NULL,
            sesiones_desde = date_trunc('second', now())
      WHERE id_usuario = $1`,
    [idUsuario, hash],
  );
  await query(`INSERT INTO auditoria (id_usuario, accion, entidad, id_entidad) VALUES ($1, $2, 'usuario', $3)`, [idUsuario, accion, String(idUsuario)]);
}

authRouter.post(
  '/cambiar-password',
  autenticar,
  ruta(async (req, res) => {
    const { actual, nueva } = cambioSchema.parse(req.body);
    const u = await queryOne(`SELECT password_hash FROM usuario WHERE id_usuario = $1`, [req.usuario!.id]);
    if (!u?.password_hash || !(await bcrypt.compare(actual, u.password_hash))) {
      throw new HttpError(400, 'La contraseña actual no es correcta');
    }
    if (actual === nueva) throw new HttpError(400, 'La nueva contraseña debe ser distinta a la actual');
    await fijarContrasena(req.usuario!.id, nueva, 'CAMBIO_PASSWORD');
    res.json({ token: firmarToken(req.usuario!.id), usuario: await cargarUsuario(req.usuario!.id) });
  }),
);

/** Cierra la sesión en todos los dispositivos y entrega un token nuevo para el actual. */
authRouter.post(
  '/cerrar-sesiones',
  autenticar,
  ruta(async (req, res) => {
    await query(`UPDATE usuario SET sesiones_desde = date_trunc('second', now()) WHERE id_usuario = $1`, [req.usuario!.id]);
    res.json({ token: firmarToken(req.usuario!.id) });
  }),
);

// ---------------------------------------------------------------- P02 · recuperar contraseña
const sha256 = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

authRouter.post(
  '/recuperar',
  ruta(async (req, res) => {
    const { correo } = z.object({ correo: z.string().trim().email() }).parse(req.body);
    const u = await queryOne(
      `SELECT u.id_usuario FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE u.correo = $1 AND u.activo AND r.acceso_web`,
      [correo],
    );
    if (u) {
      const token = crypto.randomBytes(32).toString('hex');
      await query(`UPDATE token_recuperacion SET usado_en = now() WHERE id_usuario = $1 AND usado_en IS NULL`, [u.id_usuario]);
      await query(`INSERT INTO token_recuperacion (id_usuario, token_hash, expira_en) VALUES ($1, $2, now() + interval '30 minutes')`, [
        u.id_usuario,
        sha256(token),
      ]);
      // El envío por correo se conecta en la etapa de notificaciones; en desarrollo el enlace sale en la consola.
      console.log(`[recuperar] Enlace para ${correo}: ${config.frontendOrigin}/restablecer?token=${token}`);
    }
    // Misma respuesta exista o no el correo, para no revelar qué cuentas existen.
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/restablecer',
  ruta(async (req, res) => {
    const { token, nueva } = z.object({ token: z.string().min(10), nueva: contrasenaSegura }).parse(req.body);
    const t = await queryOne(
      `SELECT id_token, id_usuario FROM token_recuperacion WHERE token_hash = $1 AND usado_en IS NULL AND expira_en > now()`,
      [sha256(token)],
    );
    if (!t) throw new HttpError(400, 'El enlace no es válido o ya caducó. Solicita uno nuevo.');
    await query(`UPDATE token_recuperacion SET usado_en = now() WHERE id_token = $1`, [t.id_token]);
    await fijarContrasena(t.id_usuario, nueva, 'RESTABLECER_PASSWORD');
    res.json({ ok: true });
  }),
);
