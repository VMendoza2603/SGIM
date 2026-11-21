import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { requierePermiso, tiene } from '../auth.js';
import { query, queryOne, transaccion, escaparLike } from '../db.js';
import { HttpError, noEncontrado, prohibido, ruta } from '../errores.js';
import { asignar } from '../servicios/asignacion.js';
import { cambiarEstado, crearIncidente, guardarFoto } from '../servicios/incidentes.js';
import { enSegundoPlano } from '../servicios/segundoPlano.js';
import { telefonoSchema } from '../servicios/telefono.js';
import { verificarCierreConIa } from '../servicios/verificacion.js';

export { DIR_UPLOADS } from '../servicios/incidentes.js';
export const incidentesRouter = Router();

const SELECT_INCIDENTE = `
  SELECT i.id_incidente, i.codigo, i.titulo, i.descripcion, i.canal, i.fecha_reporte, i.fecha_limite,
         i.fecha_asignacion, i.fecha_inicio_atencion, i.fecha_resolucion, i.fecha_cierre,
         i.puntaje_prioridad, i.prioridad_manual, i.categoria_manual, i.diagnostico_preliminar, i.calificacion,
         i.ubicacion_texto, i.id_ubicacion, i.id_equipo, i.id_categoria, i.id_prioridad, i.id_tecnico,
         e.codigo AS estado, e.nombre AS estado_nombre, e.es_final,
         p.codigo AS prioridad, c.codigo AS categoria_codigo, c.nombre AS categoria,
         u.codigo AS ubicacion_codigo, u.nombre AS ubicacion, b.codigo AS bloque_codigo, b.nombre AS bloque,
         eq.codigo_inventario AS equipo_codigo, te.nombre AS equipo_tipo, eq.marca AS equipo_marca, eq.modelo AS equipo_modelo,
         r.nombres || ' ' || r.apellidos AS reportante, r.tipo_miembro, r.telefono_wa AS reportante_telefono,
         ut.nombres || ' ' || ut.apellidos AS tecnico, p.horas_solucion AS horas_prioridad,
         (i.fecha_limite < now() AND NOT e.es_final) AS sla_vencido,
         -- Asignación vigente: cuándo y quién la hizo (NULL = el sistema, asignación automática)
         (SELECT json_build_object('en', a.asignado_en, 'automatica', a.automatica, 'por', ua.nombres || ' ' || ua.apellidos)
            FROM asignacion a LEFT JOIN usuario ua ON ua.id_usuario = a.id_asignado_por
           WHERE a.id_incidente = i.id_incidente AND a.activa) AS asignacion_actual,
         (i.id_ubicacion IS NULL OR EXISTS (
            SELECT 1 FROM analisis_ia a WHERE a.id_incidente = i.id_incidente AND a.tipo IN ('TEXTO', 'IMAGEN')
               AND a.confianza < (SELECT valor::numeric FROM parametro_sistema WHERE clave = 'ia.umbral_confianza'))
         ) AND NOT i.categoria_manual AND e.codigo = 'PENDIENTE' AS revision_manual
    FROM incidente i
    JOIN estado_incidente e  ON e.id_estado = i.id_estado
    JOIN usuario r           ON r.id_usuario = i.id_reportante
    LEFT JOIN prioridad p    ON p.id_prioridad = i.id_prioridad
    LEFT JOIN categoria c    ON c.id_categoria = i.id_categoria
    LEFT JOIN ubicacion u    ON u.id_ubicacion = i.id_ubicacion
    LEFT JOIN bloque b       ON b.id_bloque = u.id_bloque
    LEFT JOIN equipo eq      ON eq.id_equipo = i.id_equipo
    LEFT JOIN tipo_equipo te ON te.id_tipo_equipo = eq.id_tipo_equipo
    LEFT JOIN tecnico t      ON t.id_tecnico = i.id_tecnico
    LEFT JOIN usuario ut     ON ut.id_usuario = t.id_usuario`;

/** El técnico solo ve lo que tiene asignado; el coordinador ve todo. */
function filtroAlcance(req: Request, params: unknown[]) {
  if (tiene(req, 'incidente.ver_todos')) return 'TRUE';
  params.push(req.usuario!.idTecnico ?? -1);
  return `i.id_tecnico = $${params.length}`;
}

async function obtenerIncidente(req: Request, codigoOId: string) {
  const params: unknown[] = [codigoOId];
  const alcance = filtroAlcance(req, params);
  const porId = /^\d+$/.test(codigoOId);
  const fila = await queryOne(`${SELECT_INCIDENTE} WHERE ${porId ? 'i.id_incidente = $1::bigint' : 'i.codigo = $1'}`, [codigoOId]);
  if (!fila) throw noEncontrado('Incidente');
  if (alcance !== 'TRUE' && fila.id_tecnico !== req.usuario!.idTecnico) {
    await query(`INSERT INTO auditoria (id_usuario, accion, entidad, id_entidad) VALUES ($1,'ACCESO_DENEGADO','incidente',$2)`, [
      req.usuario!.id,
      String(fila.id_incidente),
    ]);
    throw prohibido('Este incidente no está asignado a ti');
  }
  return fila;
}

// ---------------------------------------------------------------- listado
incidentesRouter.get(
  '/',
  requierePermiso('incidente.ver_todos', 'incidente.ver_asignados'),
  ruta(async (req, res) => {
    const f = z
      .object({
        estado: z.string().optional(),
        prioridad: z.string().optional(),
        categoria: z.string().optional(),
        bloque: z.string().optional(),
        tecnico: z.coerce.number().optional(),
        vencido: z.enum(['1', 'true']).optional(),
        activos: z.enum(['1', 'true']).optional(),
        q: z.string().trim().optional(),
        pagina: z.coerce.number().int().min(1).default(1),
        porPagina: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(req.query);
    const params: unknown[] = [];
    const where = [filtroAlcance(req, params)];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (f.estado) add('e.codigo = ?', f.estado);
    if (f.prioridad) add('p.codigo = ?', f.prioridad);
    if (f.categoria) add('c.codigo = ?', f.categoria);
    if (f.bloque) add('b.codigo = ?', f.bloque);
    if (f.tecnico) add('i.id_tecnico = ?', f.tecnico);
    if (f.vencido) where.push('i.fecha_limite < now() AND NOT e.es_final');
    if (f.activos) where.push('NOT e.es_final');
    if (f.q) {
      add(
        `(i.codigo ILIKE ? OR i.titulo ILIKE $${params.length + 1} OR u.codigo ILIKE $${params.length + 1} OR eq.codigo_inventario ILIKE $${params.length + 1}
          OR (ut.nombres || ' ' || ut.apellidos) ILIKE $${params.length + 1})`,
        `%${escaparLike(f.q)}%`,
      );
    }

    const base = `${SELECT_INCIDENTE} WHERE ${where.join(' AND ')}`;
    const total = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM (${base}) x`, params);
    const filas = await query(
      `${base} ORDER BY e.es_final, (i.fecha_limite < now()) DESC, p.nivel DESC NULLS LAST, i.fecha_reporte DESC
       LIMIT ${f.porPagina} OFFSET ${(f.pagina - 1) * f.porPagina}`,
      params,
    );
    res.json({ total: total?.n ?? 0, pagina: f.pagina, porPagina: f.porPagina, filas });
  }),
);

// ---------------------------------------------------------------- registro manual (canal WEB, p. ej. una llamada)
const nuevoSchema = z.object({
  reportante: z.union([
    z.object({ id_usuario: z.number().int() }),
    z.object({
      nombres: z.string().trim().min(2),
      apellidos: z.string().trim().min(2),
      telefono_wa: telefonoSchema,
      tipo_miembro: z.enum(['ESTUDIANTE', 'DOCENTE', 'ADMINISTRATIVO']),
    }),
  ]),
  titulo: z.string().trim().min(4).max(150),
  descripcion: z.string().trim().min(5),
  id_ubicacion: z.number().int(),
  id_equipo: z.number().int().nullable().optional(),
  id_categoria: z.number().int(),
  riesgo_personas: z.boolean().default(false),
  riesgo_electrico: z.boolean().default(false),
  fuga_activa: z.boolean().default(false),
  afecta_clases: z.boolean().default(false),
  personas_afectadas: z.number().int().min(0).nullable().optional(),
});

incidentesRouter.post(
  '/',
  requierePermiso('incidente.crear_web'),
  ruta(async (req, res) => {
    const b = nuevoSchema.parse(req.body);
    const creado = await transaccion({ idUsuario: req.usuario!.id, idRol: req.usuario!.idRol, comentario: 'Registrado desde el panel web' }, async (c) => {
      let idReportante: number;
      if ('id_usuario' in b.reportante) {
        idReportante = b.reportante.id_usuario;
      } else {
        const r = b.reportante;
        const { rows } = await c.query(
          `INSERT INTO usuario (id_rol, nombres, apellidos, telefono_wa, tipo_miembro)
           VALUES ((SELECT id_rol FROM rol WHERE codigo = 'COMUNIDAD'), $1, $2, $3, $4)
           ON CONFLICT (telefono_wa) DO UPDATE SET nombres = usuario.nombres
           RETURNING id_usuario`,
          [r.nombres, r.apellidos, r.telefono_wa, r.tipo_miembro],
        );
        idReportante = rows[0].id_usuario;
      }
      return crearIncidente(c, {
        idReportante,
        canal: 'WEB',
        titulo: b.titulo,
        descripcion: b.descripcion,
        idUbicacion: b.id_ubicacion,
        idEquipo: b.id_equipo ?? null,
        idCategoria: b.id_categoria,
        riesgo_personas: b.riesgo_personas,
        riesgo_electrico: b.riesgo_electrico,
        fuga_activa: b.fuga_activa,
        afecta_clases: b.afecta_clases,
        personas_afectadas: b.personas_afectadas ?? null,
      });
    });
    res.status(201).json({ id_incidente: creado.id_incidente, codigo: creado.codigo, titulo: creado.titulo });
  }),
);

// ---------------------------------------------------------------- detalle
incidentesRouter.get(
  '/:codigo',
  requierePermiso('incidente.ver_todos', 'incidente.ver_asignados'),
  ruta(async (req, res) => {
    const inc = await obtenerIncidente(req, req.params.codigo);
    const id = inc.id_incidente;
    const [analisis, reglas, historial, asignaciones, evidencias, acciones, transiciones, verificacion] = await Promise.all([
      tiene(req, 'incidente.ver_analisis_ia')
        ? query(
            `SELECT a.tipo, a.modelo, a.confianza, a.anomalias, a.variables_riesgo, a.interpretacion, a.tipo_equipo_detectado,
                    c.nombre AS categoria_sugerida, a.creado_en
               FROM analisis_ia a LEFT JOIN categoria c ON c.id_categoria = a.id_categoria_sugerida
              WHERE a.id_incidente = $1 ORDER BY a.creado_en`,
            [id],
          )
        : [],
      query(
        `SELECT r.nombre, ir.puntos_aplicados, p.codigo AS fuerza
           FROM incidente_regla ir JOIN regla_prioridad r ON r.id_regla = ir.id_regla
           LEFT JOIN prioridad p ON p.id_prioridad = r.forzar_prioridad
          WHERE ir.id_incidente = $1 ORDER BY ir.puntos_aplicados DESC`,
        [id],
      ),
      query(
        `SELECT h.creado_en, h.canal, h.comentario, ea.nombre AS desde, en.codigo AS hacia_codigo, en.nombre AS hacia,
                u.nombres || ' ' || u.apellidos AS usuario
           FROM historial_estado h
           LEFT JOIN estado_incidente ea ON ea.id_estado = h.id_estado_anterior
           JOIN estado_incidente en ON en.id_estado = h.id_estado_nuevo
           LEFT JOIN usuario u ON u.id_usuario = h.id_usuario
          WHERE h.id_incidente = $1 ORDER BY h.creado_en`,
        [id],
      ),
      query(
        `SELECT a.asignado_en, a.automatica, a.motivo, a.activa, ut.nombres || ' ' || ut.apellidos AS tecnico,
                ua.nombres || ' ' || ua.apellidos AS asignado_por
           FROM asignacion a JOIN tecnico t ON t.id_tecnico = a.id_tecnico JOIN usuario ut ON ut.id_usuario = t.id_usuario
           LEFT JOIN usuario ua ON ua.id_usuario = a.id_asignado_por
          WHERE a.id_incidente = $1 ORDER BY a.asignado_en`,
        [id],
      ),
      query(
        `SELECT id_evidencia, tipo, url_archivo, descripcion, creado_en FROM evidencia WHERE id_incidente = $1 ORDER BY creado_en`,
        [id],
      ),
      query(
        `SELECT a.tipo, a.descripcion, a.materiales, a.canal, a.creado_en, u.nombres || ' ' || u.apellidos AS tecnico
           FROM accion_mantenimiento a JOIN tecnico t ON t.id_tecnico = a.id_tecnico JOIN usuario u ON u.id_usuario = t.id_usuario
          WHERE a.id_incidente = $1 ORDER BY a.creado_en DESC`,
        [id],
      ),
      query(
        `SELECT ed.codigo, ed.nombre, te.requiere_evidencia, te.requiere_comentario
           FROM transicion_estado te
           JOIN estado_incidente eo ON eo.id_estado = te.id_estado_origen
           JOIN estado_incidente ed ON ed.id_estado = te.id_estado_destino
          WHERE eo.codigo = $1 AND te.id_rol = $2 ORDER BY ed.orden`,
        [inc.estado, req.usuario!.idRol],
      ),
      queryOne(
        `SELECT v.resultado_ia, v.confianza_ia, v.confirmacion_reportante, v.resultado_final, v.observacion
           FROM verificacion_cierre v WHERE v.id_incidente = $1 ORDER BY v.creado_en DESC LIMIT 1`,
        [id],
      ),
    ]);
    res.json({ ...inc, analisis, reglas, historial, asignaciones, evidencias, acciones, transiciones, verificacion });
  }),
);

// ---------------------------------------------------------------- reclasificar (coordinador)
incidentesRouter.patch(
  '/:id/clasificacion',
  requierePermiso('incidente.reclasificar'),
  ruta(async (req, res) => {
    const b = z
      .object({
        id_categoria: z.number().int().nullable(),
        id_prioridad: z.number().int().nullable(),
        id_ubicacion: z.number().int().nullable(),
        id_equipo: z.number().int().nullable(),
        // Tiempo estimado de reparación de este incidente; si no se envía, se usa el plazo de su prioridad
        horas_estimadas: z.number().positive().max(8760).optional(),
      })
      .parse(req.body);
    const antes = await obtenerIncidente(req, req.params.id);
    await transaccion({ idUsuario: req.usuario!.id, idRol: req.usuario!.idRol }, async (c) => {
      await c.query(
        `UPDATE incidente SET id_categoria = $2, id_prioridad = $3, id_ubicacion = $4, id_equipo = $5,
                categoria_manual = categoria_manual OR id_categoria IS DISTINCT FROM $2,
                prioridad_manual = prioridad_manual OR id_prioridad IS DISTINCT FROM $3
          WHERE id_incidente = $1`,
        [antes.id_incidente, b.id_categoria, b.id_prioridad, b.id_ubicacion, b.id_equipo],
      );
      // Va después: si también cambió la prioridad, el trigger recalculó el plazo y aquí se respeta el valor elegido
      if (b.horas_estimadas) {
        await c.query(`UPDATE incidente SET fecha_limite = fecha_reporte + make_interval(secs => $2 * 3600) WHERE id_incidente = $1`, [
          antes.id_incidente,
          b.horas_estimadas,
        ]);
      }
      await c.query(
        `INSERT INTO auditoria (id_usuario, accion, entidad, id_entidad, datos_anteriores, datos_nuevos)
         VALUES ($1, 'EDITAR', 'incidente', $2, $3, $4)`,
        [
          req.usuario!.id,
          String(antes.id_incidente),
          JSON.stringify({
            id_categoria: antes.id_categoria,
            id_prioridad: antes.id_prioridad,
            id_ubicacion: antes.id_ubicacion,
            id_equipo: antes.id_equipo,
            fecha_limite: antes.fecha_limite,
          }),
          JSON.stringify(b),
        ],
      );
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- asignar / reasignar (coordinador)
incidentesRouter.post(
  '/:id/asignar',
  requierePermiso('incidente.asignar'),
  ruta(async (req, res) => {
    const b = z.object({ id_tecnico: z.number().int(), motivo: z.string().trim().max(255).optional() }).parse(req.body);
    const inc = await obtenerIncidente(req, req.params.id);
    if (inc.es_final) throw new HttpError(409, 'No se puede asignar un incidente cerrado');
    await transaccion({ idUsuario: req.usuario!.id, idRol: req.usuario!.idRol, comentario: b.motivo }, (c) =>
      asignar(c, inc, b.id_tecnico, {
        automatica: false,
        motivo: b.motivo ?? (inc.id_tecnico ? 'Reasignación manual' : 'Asignación manual'),
        idAsignadoPor: req.usuario!.id,
      }),
    );
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- cambio de estado (según transicion_estado)
incidentesRouter.post(
  '/:id/estado',
  requierePermiso('incidente.cambiar_estado', 'incidente.verificar_cierre', 'incidente.cancelar'),
  ruta(async (req, res) => {
    const b = z.object({ estado: z.string(), comentario: z.string().trim().max(500).optional() }).parse(req.body);
    const inc = await obtenerIncidente(req, req.params.id);
    const actor = { idUsuario: req.usuario!.id, idRol: req.usuario!.idRol, rol: req.usuario!.rol };
    await transaccion({ idUsuario: actor.idUsuario, idRol: actor.idRol, comentario: b.comentario }, (c) =>
      cambiarEstado(c, inc, b.estado, actor, b.comentario),
    );
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- acciones del técnico
incidentesRouter.post(
  '/:id/acciones',
  requierePermiso('incidente.registrar_accion'),
  ruta(async (req, res) => {
    const b = z
      .object({
        tipo: z.enum(['DIAGNOSTICO', 'CORRECTIVA', 'PREVENTIVA', 'OBSERVACION']),
        descripcion: z.string().trim().min(3, 'Describe el trabajo realizado'),
        materiales: z.string().trim().max(500).optional(),
      })
      .parse(req.body);
    const inc = await obtenerIncidente(req, req.params.id);
    if (inc.estado !== 'EN_PROCESO') throw new HttpError(409, 'Inicia la atención antes de registrar acciones');
    await query(
      `INSERT INTO accion_mantenimiento (id_incidente, id_tecnico, tipo, descripcion, materiales, canal, inicio, fin)
       VALUES ($1, $2, $3, $4, $5, 'WEB', now(), now())`,
      [inc.id_incidente, req.usuario!.idTecnico, b.tipo, b.descripcion, b.materiales ?? null],
    );
    res.status(201).json({ ok: true });
  }),
);

// ---------------------------------------------------------------- evidencias (foto en data URL)
incidentesRouter.post(
  '/:id/evidencias',
  requierePermiso('incidente.subir_evidencia'),
  ruta(async (req, res) => {
    const b = z
      .object({ tipo: z.enum(['AVANCE', 'CIERRE']), imagen: z.string(), descripcion: z.string().trim().max(255).optional() })
      .parse(req.body);
    const inc = await obtenerIncidente(req, req.params.id);
    if (inc.estado !== 'EN_PROCESO') throw new HttpError(409, 'Solo puedes subir fotos mientras el incidente está en proceso');
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(b.imagen);
    if (!m) throw new HttpError(400, 'La foto debe ser JPG, PNG o WEBP');
    const buffer = Buffer.from(m[2], 'base64');
    const maxMb = Number((await queryOne(`SELECT valor FROM parametro_sistema WHERE clave='archivo.max_mb'`))?.valor ?? 5);
    if (buffer.length > maxMb * 1024 * 1024) throw new HttpError(413, `La foto supera ${maxMb} MB`);
    const foto = await guardarFoto(buffer, m[1], inc.codigo);
    const ev = await queryOne(
      `INSERT INTO evidencia (id_incidente, id_subido_por, tipo, url_archivo, mime_type, tamano_bytes, hash_sha256, descripcion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_evidencia`,
      [inc.id_incidente, req.usuario!.id, b.tipo, foto.url, m[1], foto.tamano, foto.hash, b.descripcion ?? null],
    );
    if (b.tipo === 'CIERRE') {
      const v = await queryOne(`INSERT INTO verificacion_cierre (id_incidente, id_evidencia) VALUES ($1, $2) RETURNING id_verificacion`, [
        inc.id_incidente,
        ev!.id_evidencia,
      ]);
      // El agente de IA compara la foto con la del reporte sin hacer esperar al técnico
      enSegundoPlano(verificarCierreConIa(v!.id_verificacion));
    }
    res.status(201).json({ id_evidencia: ev!.id_evidencia, url: foto.url });
  }),
);
