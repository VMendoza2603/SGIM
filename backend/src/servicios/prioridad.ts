import type pg from 'pg';
import { pool } from '../db.js';

/** Variables que evalúa el motor de reglas (las produce el agente de IA o el formulario web). */
export interface VariablesRiesgo {
  categoria?: string | null; // código: ELEC, AGUA...
  riesgo_personas?: boolean;
  riesgo_electrico?: boolean;
  fuga_activa?: boolean;
  afecta_clases?: boolean;
  personas_afectadas?: number | null;
  criticidad_ubicacion?: number | null;
  reincidencias_30d?: number | null;
}

export interface ReglaAplicada {
  id_regla: number;
  nombre: string;
  puntos: number;
  fuerza: string | null;
}

export interface ResultadoPrioridad {
  puntaje: number;
  idPrioridad: number;
  prioridad: string;
  reglas: ReglaAplicada[];
}

type Db = pg.Pool | pg.PoolClient;

function cumple(valorVariable: unknown, operador: string, valorRegla: string): boolean {
  if (valorVariable === undefined || valorVariable === null) return false;
  const lista = valorRegla.split(',').map((v) => v.trim().toLowerCase());
  const v = String(valorVariable).toLowerCase();
  const n = Number(valorVariable);
  const r = Number(valorRegla);
  switch (operador) {
    case '=': return v === valorRegla.toLowerCase();
    case '!=': return v !== valorRegla.toLowerCase();
    case '>': return n > r;
    case '>=': return n >= r;
    case '<': return n < r;
    case '<=': return n <= r;
    case 'IN': return lista.includes(v);
    case 'CONTAINS': return v.includes(valorRegla.toLowerCase());
    default: return false;
  }
}

/** Evalúa las reglas activas y devuelve el puntaje, la prioridad resultante y qué reglas se dispararon. */
export async function calcularPrioridad(vars: VariablesRiesgo, db: Db = pool): Promise<ResultadoPrioridad> {
  const { rows: reglas } = await db.query(
    `SELECT r.id_regla, r.nombre, r.variable, r.operador, r.valor, r.puntos, p.nivel AS nivel_forzado, p.codigo AS fuerza
       FROM regla_prioridad r LEFT JOIN prioridad p ON p.id_prioridad = r.forzar_prioridad
      WHERE r.activo ORDER BY r.orden, r.id_regla`,
  );
  const { rows: prioridades } = await db.query(`SELECT id_prioridad, codigo, nivel, puntaje_min, puntaje_max FROM prioridad ORDER BY nivel`);

  const aplicadas: ReglaAplicada[] = [];
  let puntaje = 0;
  let nivelForzado = 0;
  for (const r of reglas) {
    if (!cumple((vars as Record<string, unknown>)[r.variable], r.operador, r.valor)) continue;
    puntaje += r.puntos;
    if (r.nivel_forzado) nivelForzado = Math.max(nivelForzado, r.nivel_forzado);
    aplicadas.push({ id_regla: r.id_regla, nombre: r.nombre, puntos: r.puntos, fuerza: r.fuerza });
  }
  puntaje = Math.max(0, puntaje);
  const porRango = prioridades.find((p) => puntaje >= p.puntaje_min && puntaje <= p.puntaje_max) ?? prioridades[prioridades.length - 1];
  const elegida = prioridades.find((p) => p.nivel === Math.max(porRango.nivel, nivelForzado)) ?? porRango;
  return { puntaje, idPrioridad: elegida.id_prioridad, prioridad: elegida.codigo, reglas: aplicadas };
}

/** Completa las variables que se derivan de la base: criticidad de la ubicación y reincidencias. */
export async function variablesDeContexto(idUbicacion: number | null, idEquipo: number | null, db: Db = pool) {
  if (!idUbicacion) return {};
  const { rows } = await db.query(
    `SELECT tu.criticidad,
            (SELECT count(*)::int FROM incidente i
              WHERE i.fecha_reporte > now() - interval '30 days'
                AND (i.id_equipo = $2 OR ($2::int IS NULL AND i.id_ubicacion = $1))) AS reincidencias
       FROM ubicacion u JOIN tipo_ubicacion tu ON tu.id_tipo_ubicacion = u.id_tipo_ubicacion
      WHERE u.id_ubicacion = $1`,
    [idUbicacion, idEquipo],
  );
  return rows[0] ? { criticidad_ubicacion: rows[0].criticidad, reincidencias_30d: rows[0].reincidencias } : {};
}
