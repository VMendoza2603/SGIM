import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { requierePermiso } from '../auth.js';
import { query, queryOne, transaccion, escaparLike } from '../db.js';
import { HttpError, noEncontrado, prohibido, ruta } from '../errores.js';
import { telefonoSchema } from '../servicios/telefono.js';
import { auditar, contrasenaTemporal } from '../servicios/auditoria.js';
import { detalleTecnico, resumenTecnicos } from '../servicios/desempeno.js';

export const personalRouter = Router();
const gestionaTec = requierePermiso('tecnico.gestionar');
const gestionaUsr = requierePermiso('usuario.gestionar');

const telefono = telefonoSchema;

// ================================================================ A08 · Técnicos
personalRouter.get(
  '/tecnicos',
  gestionaTec,
  ruta(async (_req, res) => {
    const tecnicos = await query(
      `SELECT t.id_tecnico, t.disponible, t.max_activos, t.turno, t.observaciones, t.es_lider,
              u.id_usuario, u.nombres, u.apellidos, u.correo, u.telefono_wa, u.cedula, u.activo,
              c.activos,
              COALESCE((SELECT json_agg(json_build_object('id', ca.id_categoria, 'nombre', ca.nombre, 'principal', tc.es_principal)
                                 ORDER BY tc.es_principal DESC, ca.nombre)
                          FROM tecnico_categoria tc JOIN categoria ca ON ca.id_categoria = tc.id_categoria
                         WHERE tc.id_tecnico = t.id_tecnico), '[]') AS especialidades,
              COALESCE((SELECT json_agg(json_build_object('id', b.id_bloque, 'codigo', b.codigo) ORDER BY b.codigo)
                          FROM tecnico_bloque tb JOIN bloque b ON b.id_bloque = tb.id_bloque
                         WHERE tb.id_tecnico = t.id_tecnico), '[]') AS zonas
         FROM tecnico t JOIN usuario u ON u.id_usuario = t.id_usuario
         LEFT JOIN v_carga_tecnico c ON c.id_tecnico = t.id_tecnico
        ORDER BY u.activo DESC, t.es_lider DESC, u.nombres`,
    );
    res.json(tecnicos);
  }),
);

/** Periodo de los indicadores: por defecto, desde el inicio del mes hasta hoy. */
const periodoSchema = z.object({
  desde: z.string().date().optional(),
  hasta: z.string().date().optional(),
});
function periodo(q: unknown) {
  const p = periodoSchema.parse(q);
  const hoy = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { desde: p.desde ?? iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: p.hasta ?? iso(hoy) };
}

/** Indicadores de todos los técnicos en el periodo (lista de Técnicos). */
personalRouter.get(
  '/tecnicos/desempeno',
  gestionaTec,
  ruta(async (req, res) => {
    const { desde, hasta } = periodo(req.query);
    res.json({ desde, hasta, filas: await resumenTecnicos(desde, hasta) });
  }),
);

/** Detalle de un técnico: indicadores e incidentes (por iniciar, en proceso, en verificación, resueltos, reasignados). */
personalRouter.get(
  '/tecnicos/:id/detalle',
  gestionaTec,
  ruta(async (req, res) => {
    const { desde, hasta } = periodo(req.query);
    const d = await detalleTecnico(Number(req.params.id), desde, hasta);
    if (!d) throw noEncontrado('Técnico');
    res.json({ desde, hasta, ...d });
  }),
);

const tecnicoSchema = z.object({
  nombres: z.string().trim().min(2).max(80),
  apellidos: z.string().trim().min(2).max(80),
  cedula: z.string().trim().max(13).nullable().optional(),
  correo: z.string().trim().email(),
  telefono_wa: telefono,
  turno: z.enum(['MATUTINO', 'VESPERTINO', 'NOCTURNO', 'COMPLETO']),
  max_activos: z.number().int().min(1).max(30),
  categorias: z.array(z.number().int()).min(1, 'Elige al menos una especialidad'),
  categoria_principal: z.number().int(),
  bloques: z.array(z.number().int()),
  /** Técnico líder: recibe todos los reportes por WhatsApp y puede reasignarlos. Solo uno; lo designa el coordinador. */
  es_lider: z.boolean().optional(),
});

/** Deja a este técnico como único líder (o le quita el cargo). */
async function guardarLider(c: import('pg').PoolClient, idTecnico: number, esLider: boolean | undefined) {
  if (esLider === undefined) return;
  if (esLider) await c.query(`UPDATE tecnico SET es_lider = FALSE WHERE es_lider AND id_tecnico <> $1`, [idTecnico]);
  await c.query(`UPDATE tecnico SET es_lider = $2 WHERE id_tecnico = $1`, [idTecnico, esLider]);
}

async function guardarEspecialidades(c: import('pg').PoolClient, idTecnico: number, b: z.infer<typeof tecnicoSchema>) {
  await c.query(`DELETE FROM tecnico_categoria WHERE id_tecnico = $1`, [idTecnico]);
  await c.query(`DELETE FROM tecnico_bloque WHERE id_tecnico = $1`, [idTecnico]);
  for (const cat of b.categorias) {
    await c.query(`INSERT INTO tecnico_categoria VALUES ($1, $2, $3)`, [idTecnico, cat, cat === b.categoria_principal]);
  }
  for (const bl of b.bloques) await c.query(`INSERT INTO tecnico_bloque VALUES ($1, $2)`, [idTecnico, bl]);
}

/** Crea el usuario TECNICO con contraseña temporal (se muestra una sola vez al coordinador). */
personalRouter.post(
  '/tecnicos',
  gestionaTec,
  ruta(async (req, res) => {
    const b = tecnicoSchema.parse(req.body);
    if (!b.categorias.includes(b.categoria_principal)) throw new HttpError(400, 'La especialidad principal debe estar entre las elegidas');
    const temporal = contrasenaTemporal();
    const hash = await bcrypt.hash(temporal, 12);
    // Si el número ya escribió al chatbot como comunidad, esa misma persona pasa a ser técnico (conserva sus reportes)
    const existente = await queryOne(
      `SELECT u.id_usuario, r.codigo AS rol FROM usuario u JOIN rol r USING (id_rol) WHERE u.telefono_wa = $1`,
      [b.telefono_wa],
    );
    if (existente && existente.rol !== 'COMUNIDAD') throw new HttpError(409, 'Ese número ya pertenece a otro usuario del panel');
    const r = await transaccion(null, async (c) => {
      const { rows } = existente
        ? await c.query(
            `UPDATE usuario SET id_rol = (SELECT id_rol FROM rol WHERE codigo = 'TECNICO'), cedula = $2, nombres = $3, apellidos = $4,
                    correo = $5, password_hash = $6, debe_cambiar_pwd = TRUE, tipo_miembro = NULL, activo = TRUE
              WHERE id_usuario = $1 RETURNING id_usuario`,
            [existente.id_usuario, b.cedula || null, b.nombres, b.apellidos, b.correo, hash],
          )
        : await c.query(
            `INSERT INTO usuario (id_rol, cedula, nombres, apellidos, correo, telefono_wa, password_hash)
             VALUES ((SELECT id_rol FROM rol WHERE codigo = 'TECNICO'), $1, $2, $3, $4, $5, $6) RETURNING id_usuario`,
            [b.cedula || null, b.nombres, b.apellidos, b.correo, b.telefono_wa, hash],
          );
      const { rows: t } = await c.query(`INSERT INTO tecnico (id_usuario, turno, max_activos) VALUES ($1, $2, $3) RETURNING id_tecnico`, [
        rows[0].id_usuario, b.turno, b.max_activos,
      ]);
      await guardarEspecialidades(c, t[0].id_tecnico, b);
      await guardarLider(c, t[0].id_tecnico, b.es_lider);
      return t[0];
    });
    await auditar(req, 'CREAR', 'tecnico', r.id_tecnico, undefined, { ...b });
    res.status(201).json({ id_tecnico: r.id_tecnico, contrasenaTemporal: temporal });
  }),
);

personalRouter.put(
  '/tecnicos/:id',
  gestionaTec,
  ruta(async (req, res) => {
    const b = tecnicoSchema.parse(req.body);
    if (!b.categorias.includes(b.categoria_principal)) throw new HttpError(400, 'La especialidad principal debe estar entre las elegidas');
    const t = await queryOne(`SELECT id_usuario FROM tecnico WHERE id_tecnico = $1`, [req.params.id]);
    if (!t) throw noEncontrado('Técnico');
    await transaccion(null, async (c) => {
      await c.query(`UPDATE usuario SET nombres=$2, apellidos=$3, cedula=$4, correo=$5, telefono_wa=$6 WHERE id_usuario=$1`, [
        t.id_usuario, b.nombres, b.apellidos, b.cedula || null, b.correo, b.telefono_wa,
      ]);
      await c.query(`UPDATE tecnico SET turno=$2, max_activos=$3 WHERE id_tecnico=$1`, [req.params.id, b.turno, b.max_activos]);
      await guardarEspecialidades(c, Number(req.params.id), b);
      await guardarLider(c, Number(req.params.id), b.es_lider);
    });
    await auditar(req, 'EDITAR', 'tecnico', req.params.id, undefined, b);
    res.json({ ok: true });
  }),
);

personalRouter.patch(
  '/tecnicos/:id/disponible',
  gestionaTec,
  ruta(async (req, res) => {
    const { disponible } = z.object({ disponible: z.boolean() }).parse(req.body);
    await query(`UPDATE tecnico SET disponible = $2 WHERE id_tecnico = $1`, [req.params.id, disponible]);
    await auditar(req, 'EDITAR', 'tecnico', req.params.id, undefined, { disponible });
    res.json({ ok: true });
  }),
);

// ================================================================ A09 · Usuarios y roles
personalRouter.get(
  '/usuarios',
  gestionaUsr,
  ruta(async (req, res) => {
    const f = z.object({ rol: z.string().optional(), tipo: z.string().optional(), estado: z.enum(['activos', 'inactivos', 'todos']).default('activos'), q: z.string().optional() }).parse(req.query);
    const usuarios = await query(
      `SELECT u.id_usuario, u.nombres, u.apellidos, u.cedula, u.correo, u.telefono_wa, u.tipo_miembro, u.activo, u.ultimo_acceso,
              u.bloqueado_hasta > now() AS bloqueado, r.codigo AS rol, r.nombre AS rol_nombre, r.acceso_web,
              (SELECT count(*)::int FROM incidente i WHERE i.id_reportante = u.id_usuario) AS reportes
         FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
        WHERE ($1::text IS NULL OR r.codigo = $1)
          AND ($2::text IS NULL OR u.tipo_miembro::text = $2)
          AND ($3 = 'todos' OR u.activo = ($3 = 'activos'))
          AND ($4::text IS NULL OR u.nombres || ' ' || u.apellidos ILIKE '%' || $4 || '%' OR u.correo ILIKE '%' || $4 || '%' OR u.telefono_wa ILIKE '%' || $4 || '%')
        ORDER BY r.id_rol, u.nombres`,
      [f.rol || null, f.tipo || null, f.estado, f.q ? escaparLike(f.q.trim()) : null],
    );
    res.json(usuarios);
  }),
);

const usuarioSchema = z.object({
  rol: z.enum(['ADMIN', 'COMUNIDAD']), // los técnicos se crean desde A08 (necesitan especialidades)
  nombres: z.string().trim().min(2).max(80),
  apellidos: z.string().trim().min(2).max(80),
  cedula: z.string().trim().max(13).nullable().optional(),
  correo: z.string().trim().email().nullable().optional(),
  telefono_wa: telefono.nullable().optional(),
  tipo_miembro: z.enum(['ESTUDIANTE', 'DOCENTE', 'ADMINISTRATIVO']).nullable().optional(),
});

personalRouter.post(
  '/usuarios',
  gestionaUsr,
  ruta(async (req, res) => {
    const b = usuarioSchema.parse(req.body);
    if (b.rol === 'ADMIN' && !b.correo) throw new HttpError(400, 'El administrador necesita correo para ingresar al panel');
    if (b.rol === 'COMUNIDAD' && (!b.telefono_wa || !b.tipo_miembro)) throw new HttpError(400, 'La comunidad se identifica por WhatsApp: indica teléfono y tipo');
    const temporal = b.rol === 'ADMIN' ? contrasenaTemporal() : null;
    const r = await queryOne(
      `INSERT INTO usuario (id_rol, cedula, nombres, apellidos, correo, telefono_wa, tipo_miembro, password_hash, debe_cambiar_pwd)
       VALUES ((SELECT id_rol FROM rol WHERE codigo = $1), $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id_usuario`,
      [
        b.rol, b.cedula || null, b.nombres, b.apellidos, b.correo || null, b.telefono_wa || null,
        b.rol === 'COMUNIDAD' ? b.tipo_miembro : null, temporal ? await bcrypt.hash(temporal, 12) : null, b.rol === 'ADMIN',
      ],
    );
    await auditar(req, 'CREAR', 'usuario', r!.id_usuario, undefined, b);
    res.status(201).json({ id_usuario: r!.id_usuario, contrasenaTemporal: temporal });
  }),
);

personalRouter.put(
  '/usuarios/:id',
  gestionaUsr,
  ruta(async (req, res) => {
    const b = usuarioSchema.omit({ rol: true }).parse(req.body);
    const antes = await queryOne(`SELECT u.*, r.codigo AS rol FROM usuario u JOIN rol r USING (id_rol) WHERE id_usuario = $1`, [req.params.id]);
    if (!antes) throw noEncontrado('Usuario');
    await query(
      `UPDATE usuario SET nombres=$2, apellidos=$3, cedula=$4, correo=$5, telefono_wa=$6, tipo_miembro=$7 WHERE id_usuario=$1`,
      [req.params.id, b.nombres, b.apellidos, b.cedula || null, b.correo || null, b.telefono_wa || null, antes.rol === 'COMUNIDAD' ? b.tipo_miembro : null],
    );
    await auditar(req, 'EDITAR', 'usuario', req.params.id, { nombres: antes.nombres, correo: antes.correo, telefono_wa: antes.telefono_wa }, b);
    res.json({ ok: true });
  }),
);

/** Activar / desactivar. No permite desactivarse a sí mismo, quitar el último admin ni dejar incidentes huérfanos. */
personalRouter.patch(
  '/usuarios/:id/activo',
  gestionaUsr,
  ruta(async (req, res) => {
    const { activo } = z.object({ activo: z.boolean() }).parse(req.body);
    const id = Number(req.params.id);
    if (!activo && id === req.usuario!.id) throw prohibido('No puedes desactivar tu propia cuenta');
    const u = await queryOne(`SELECT r.codigo AS rol, t.id_tecnico FROM usuario u JOIN rol r USING (id_rol) LEFT JOIN tecnico t USING (id_usuario) WHERE u.id_usuario = $1`, [id]);
    if (!u) throw noEncontrado('Usuario');
    if (!activo && u.rol === 'ADMIN') {
      const otros = await queryOne<{ n: number }>(`SELECT count(*)::int n FROM usuario u JOIN rol r USING (id_rol) WHERE r.codigo='ADMIN' AND u.activo AND u.id_usuario <> $1`, [id]);
      if (!otros!.n) throw prohibido('Debe quedar al menos un administrador activo');
    }
    if (!activo && u.id_tecnico) {
      const abiertos = await queryOne<{ n: number }>(
        `SELECT count(*)::int n FROM incidente i JOIN estado_incidente e USING (id_estado) WHERE i.id_tecnico = $1 AND NOT e.es_final`,
        [u.id_tecnico],
      );
      if (abiertos!.n) throw new HttpError(409, `El técnico tiene ${abiertos!.n} incidente(s) activo(s). Reasígnalos antes de desactivarlo.`);
    }
    await query(`UPDATE usuario SET activo = $2, sesiones_desde = CASE WHEN $2 THEN sesiones_desde ELSE now() END WHERE id_usuario = $1`, [id, activo]);
    await auditar(req, activo ? 'ACTIVAR' : 'DESACTIVAR', 'usuario', id);
    res.json({ ok: true });
  }),
);

/** Restablece la contraseña de un usuario del panel: genera una temporal que debe cambiar al ingresar. */
personalRouter.post(
  '/usuarios/:id/restablecer',
  gestionaUsr,
  ruta(async (req, res) => {
    const u = await queryOne(`SELECT r.acceso_web FROM usuario u JOIN rol r USING (id_rol) WHERE id_usuario = $1`, [req.params.id]);
    if (!u) throw noEncontrado('Usuario');
    if (!u.acceso_web) throw new HttpError(400, 'Los usuarios de la comunidad no tienen contraseña');
    const temporal = contrasenaTemporal();
    await query(
      `UPDATE usuario SET password_hash = $2, debe_cambiar_pwd = TRUE, intentos_fallidos = 0, bloqueado_hasta = NULL, sesiones_desde = now() WHERE id_usuario = $1`,
      [req.params.id, await bcrypt.hash(temporal, 12)],
    );
    await auditar(req, 'RESTABLECER_PASSWORD', 'usuario', req.params.id);
    res.json({ contrasenaTemporal: temporal });
  }),
);

personalRouter.get(
  '/roles',
  gestionaUsr,
  ruta(async (_req, res) => {
    const [roles, permisos, asignados] = await Promise.all([
      query(`SELECT id_rol, codigo, nombre, descripcion, acceso_web FROM rol ORDER BY id_rol`),
      query(`SELECT id_permiso, codigo, modulo, descripcion FROM permiso ORDER BY modulo, codigo`),
      query(`SELECT id_rol, id_permiso FROM rol_permiso`),
    ]);
    res.json({ roles, permisos, asignados });
  }),
);

/** Ajusta los permisos de un rol. El rol ADMIN no puede perder la gestión de usuarios (evita quedar sin acceso). */
personalRouter.put(
  '/roles/:id/permisos',
  gestionaUsr,
  ruta(async (req, res) => {
    const { permisos } = z.object({ permisos: z.array(z.number().int()) }).parse(req.body);
    const rol = await queryOne(`SELECT codigo FROM rol WHERE id_rol = $1`, [req.params.id]);
    if (!rol) throw noEncontrado('Rol');
    if (rol.codigo === 'ADMIN') {
      const clave = await queryOne(`SELECT id_permiso FROM permiso WHERE codigo = 'usuario.gestionar'`);
      if (!permisos.includes(clave!.id_permiso)) throw prohibido('El administrador debe conservar el permiso de gestionar usuarios');
    }
    await transaccion(null, async (c) => {
      await c.query(`DELETE FROM rol_permiso WHERE id_rol = $1`, [req.params.id]);
      for (const p of permisos) await c.query(`INSERT INTO rol_permiso VALUES ($1, $2)`, [req.params.id, p]);
    });
    await auditar(req, 'EDITAR_PERMISOS', 'rol', req.params.id, undefined, { permisos });
    res.json({ ok: true });
  }),
);
