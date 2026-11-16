import { Router } from 'express';
import { requierePermiso } from '../auth.js';
import { query } from '../db.js';
import { ruta } from '../errores.js';

export const catalogosRouter = Router();

/** Catálogos para filtros y formularios del panel. */
catalogosRouter.get(
  '/',
  ruta(async (_req, res) => {
    const [categorias, prioridades, estados, bloques, ubicaciones, equipos, tecnicos] = await Promise.all([
      query(`SELECT id_categoria AS id, codigo, nombre FROM categoria WHERE activo ORDER BY nombre`),
      query(`SELECT id_prioridad AS id, codigo, nombre, nivel, horas_respuesta, horas_solucion FROM prioridad ORDER BY nivel DESC`),
      query(`SELECT id_estado AS id, codigo, nombre FROM estado_incidente ORDER BY orden`),
      query(`SELECT id_bloque AS id, codigo, nombre FROM bloque WHERE activo ORDER BY codigo`),
      query(
        `SELECT u.id_ubicacion AS id, u.codigo, u.nombre, b.codigo AS bloque
           FROM ubicacion u JOIN bloque b ON b.id_bloque = u.id_bloque WHERE u.activo ORDER BY u.codigo`,
      ),
      query(
        `SELECT e.id_equipo AS id, e.codigo_inventario AS codigo, te.nombre AS tipo, e.id_ubicacion
           FROM equipo e JOIN tipo_equipo te ON te.id_tipo_equipo = e.id_tipo_equipo WHERE e.activo ORDER BY e.codigo_inventario`,
      ),
      query(`SELECT id_tecnico AS id, tecnico AS nombre, disponible, max_activos, activos FROM v_carga_tecnico ORDER BY tecnico`),
    ]);
    res.json({ categorias, prioridades, estados, bloques, ubicaciones, equipos, tecnicos });
  }),
);

/** Búsqueda de miembros de la comunidad para registrar un incidente en nombre de alguien (A02). */
catalogosRouter.get(
  '/reportantes',
  requierePermiso('incidente.crear_web'),
  ruta(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json([]);
    res.json(
      await query(
        `SELECT u.id_usuario, u.nombres || ' ' || u.apellidos AS nombre, u.telefono_wa, u.tipo_miembro
           FROM usuario u JOIN rol r USING (id_rol)
          WHERE r.codigo = 'COMUNIDAD' AND u.activo
            AND (u.nombres || ' ' || u.apellidos ILIKE '%' || $1 || '%' OR u.telefono_wa LIKE '%' || $1 || '%')
          ORDER BY u.nombres LIMIT 10`,
        [q],
      ),
    );
  }),
);
