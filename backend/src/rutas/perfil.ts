import { Router } from 'express';
import { z } from 'zod';
import { requierePermiso } from '../auth.js';
import { query, queryOne } from '../db.js';
import { ruta } from '../errores.js';
import { telefonoSchema } from '../servicios/telefono.js';

export const perfilRouter = Router();

/** T04 · Datos propios. Nombre, correo, rol y especialidades solo los cambia el coordinador. */
perfilRouter.get(
  '/',
  requierePermiso('perfil.editar'),
  ruta(async (req, res) => {
    const u = await queryOne(
      `SELECT u.nombres, u.apellidos, u.correo, u.telefono_wa, u.cedula, u.ultimo_acceso, r.nombre AS rol,
              t.disponible, t.turno, t.max_activos,
              COALESCE((SELECT json_agg(json_build_object('nombre', c.nombre, 'principal', tc.es_principal) ORDER BY tc.es_principal DESC, c.nombre)
                          FROM tecnico_categoria tc JOIN categoria c USING (id_categoria) WHERE tc.id_tecnico = t.id_tecnico), '[]') AS especialidades,
              COALESCE((SELECT json_agg(b.codigo ORDER BY b.codigo) FROM tecnico_bloque tb JOIN bloque b USING (id_bloque)
                         WHERE tb.id_tecnico = t.id_tecnico), '[]') AS zonas
         FROM usuario u JOIN rol r USING (id_rol) LEFT JOIN tecnico t USING (id_usuario)
        WHERE u.id_usuario = $1`,
      [req.usuario!.id],
    );
    res.json(u);
  }),
);

perfilRouter.put(
  '/',
  requierePermiso('perfil.editar'),
  ruta(async (req, res) => {
    const { telefono_wa } = z.object({ telefono_wa: telefonoSchema }).parse(req.body);
    await query(`UPDATE usuario SET telefono_wa = $2 WHERE id_usuario = $1`, [req.usuario!.id, telefono_wa]);
    res.json({ ok: true });
  }),
);

// La disponibilidad del técnico ya no la cambia el propio técnico (2026-11-15): solo el coordinador, en Técnicos → Editar.
