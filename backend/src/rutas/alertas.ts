import { Router } from 'express';
import { requierePermiso, tiene } from '../auth.js';
import { query } from '../db.js';
import { ruta } from '../errores.js';

export const alertasRouter = Router();

interface Alerta {
  codigo: string;
  titulo: string;
  nivel: 'bad' | 'warn' | 'info';
  motivo: string;
  fecha_limite: string | null;
}

/**
 * Campana de la barra superior: lo que necesita atención ahora, según el rol.
 *  - Coordinador: fuera de plazo, por vencer (queda la mitad del tiempo estimado o menos), revisión manual y cierres por aprobar.
 *  - Técnico: incidentes nuevos por iniciar y sus plazos.
 */
alertasRouter.get(
  '/',
  requierePermiso('incidente.ver_todos', 'incidente.ver_asignados'),
  ruta(async (req, res) => {
    const coordinador = tiene(req, 'incidente.ver_todos');
    const filas = await query(
      `SELECT i.codigo, i.titulo, e.codigo AS estado, i.fecha_limite,
              (i.fecha_limite < now()) AS fuera_de_plazo,
              (i.fecha_limite >= now() AND now() >= i.fecha_reporte + (i.fecha_limite - i.fecha_reporte) / 2) AS por_vencer,
              (i.id_ubicacion IS NULL OR EXISTS (
                 SELECT 1 FROM analisis_ia a WHERE a.id_incidente = i.id_incidente AND a.tipo IN ('TEXTO', 'IMAGEN')
                    AND a.confianza < (SELECT valor::numeric FROM parametro_sistema WHERE clave = 'ia.umbral_confianza'))
              ) AND NOT i.categoria_manual AND e.codigo = 'PENDIENTE' AS revision_manual
         FROM incidente i JOIN estado_incidente e ON e.id_estado = i.id_estado
        WHERE NOT e.es_final AND ($1 OR i.id_tecnico = $2)
        ORDER BY i.fecha_limite NULLS LAST`,
      [coordinador, req.usuario!.idTecnico ?? -1],
    );

    const alertas: Alerta[] = [];
    const agregar = (f: any, nivel: Alerta['nivel'], motivo: string) =>
      alertas.push({ codigo: f.codigo, titulo: f.titulo, nivel, motivo, fecha_limite: f.fecha_limite });
    for (const f of filas) {
      // El plazo corre mientras se repara; en verificación ya terminó el técnico y decide el coordinador
      if (f.estado !== 'EN_VERIFICACION') {
        if (f.fuera_de_plazo) agregar(f, 'bad', 'Fuera de plazo');
        else if (f.por_vencer) agregar(f, 'warn', 'Por vencer');
      }
      if (coordinador && f.revision_manual) agregar(f, 'warn', 'Revisión manual: confirma ubicación o categoría');
      if (coordinador && f.estado === 'EN_VERIFICACION') agregar(f, 'info', 'Cierre por aprobar');
      if (!coordinador && f.estado === 'ASIGNADO') agregar(f, 'info', 'Nuevo incidente asignado: inicia la atención');
    }
    const orden = { bad: 0, warn: 1, info: 2 };
    alertas.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
    res.json(alertas.slice(0, 50));
  }),
);
