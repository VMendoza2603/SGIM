import { Router } from 'express';
import { z } from 'zod';
import { requierePermiso } from '../auth.js';
import { query, queryOne, transaccion } from '../db.js';
import { HttpError, ruta } from '../errores.js';
import { auditar } from '../servicios/auditoria.js';

export const configuracionRouter = Router();

/** Parámetros que identifican cuentas externas: se muestran enmascarados (A13). */
const SENSIBLES = new Set(['wa.phone_number_id']);
const enmascarar = (v: string) => (v.length > 4 ? `••••••••${v.slice(-4)}` : v ? '••••' : '');

configuracionRouter.get(
  '/',
  requierePermiso('parametro.gestionar', 'catalogo.gestionar'),
  ruta(async (_req, res) => {
    const [parametros, prioridades, ultimoMensaje] = await Promise.all([
      query(`SELECT clave, valor, tipo_dato, descripcion, editable FROM parametro_sistema ORDER BY clave`),
      query(`SELECT id_prioridad, codigo, nombre, puntaje_min, puntaje_max, horas_respuesta, horas_solucion FROM prioridad ORDER BY nivel DESC`),
      queryOne(`SELECT max(creado_en) AS fecha FROM mensaje WHERE direccion = 'ENTRANTE'`),
    ]);
    res.json({
      parametros: parametros.map((p) => (SENSIBLES.has(p.clave) ? { ...p, valor: enmascarar(p.valor), sensible: true } : p)),
      prioridades,
      whatsapp: { ultimoEvento: ultimoMensaje?.fecha ?? null },
    });
  }),
);

const validar: Record<string, (v: string) => boolean> = {
  INT: (v) => /^-?\d+$/.test(v),
  DECIMAL: (v) => /^\d+(\.\d+)?$/.test(v),
  BOOL: (v) => v === 'true' || v === 'false',
  JSON: (v) => { try { JSON.parse(v); return true; } catch { return false; } },
  TEXT: () => true,
};

/** Límites razonables por parámetro: evitan, por ejemplo, un umbral de IA de 5 o un bloqueo de 0 minutos. */
const RANGOS: Record<string, [number, number]> = {
  'ia.umbral_confianza': [0, 1],
  'verificacion.umbral_ia': [0, 1],
  'seguridad.max_intentos_login': [1, 20],
  'seguridad.minutos_bloqueo': [1, 1440],
  'verificacion.horas_confirmar': [1, 720],
  'archivo.max_mb': [1, 20],
};

configuracionRouter.put(
  '/parametros',
  requierePermiso('parametro.gestionar'),
  ruta(async (req, res) => {
    const cambios = z.record(z.string(), z.string()).parse(req.body);
    const actuales = await query(`SELECT clave, valor, tipo_dato, editable FROM parametro_sistema WHERE clave = ANY($1)`, [Object.keys(cambios)]);
    for (const p of actuales) {
      const v = cambios[p.clave];
      if (!p.editable) throw new HttpError(400, `El parámetro ${p.clave} no es editable`);
      if (SENSIBLES.has(p.clave) && v.startsWith('••')) delete cambios[p.clave]; // no se tocó
      else if (!validar[p.tipo_dato](v)) throw new HttpError(400, `Valor inválido para ${p.clave}`);
      else if (RANGOS[p.clave] && (Number(v) < RANGOS[p.clave][0] || Number(v) > RANGOS[p.clave][1])) {
        throw new HttpError(400, `${p.clave} debe estar entre ${RANGOS[p.clave][0]} y ${RANGOS[p.clave][1]}`);
      }
    }
    if (Object.keys(cambios).length === 0) return res.json({ ok: true }); // nada que guardar ni auditar
    await transaccion(null, async (c) => {
      for (const [clave, valor] of Object.entries(cambios)) {
        await c.query(`UPDATE parametro_sistema SET valor = $2, actualizado_en = now() WHERE clave = $1`, [clave, valor]);
      }
    });
    await auditar(req, 'EDITAR', 'parametro_sistema', Object.keys(cambios).join(','), undefined,
      Object.fromEntries(Object.entries(cambios).map(([k, v]) => [k, SENSIBLES.has(k) ? '(oculto)' : v])));
    res.json({ ok: true });
  }),
);

/** Plazos de atención y solución por prioridad (SLA). */
configuracionRouter.put(
  '/prioridades',
  requierePermiso('catalogo.gestionar'),
  ruta(async (req, res) => {
    const filas = z
      .array(z.object({ id_prioridad: z.number().int(), horas_respuesta: z.number().int().min(1).max(720), horas_solucion: z.number().int().min(1).max(2160) }))
      .parse(req.body);
    for (const f of filas) {
      if (f.horas_respuesta > f.horas_solucion) throw new HttpError(400, 'El plazo de respuesta no puede superar al de solución');
    }
    await transaccion(null, async (c) => {
      for (const f of filas) {
        await c.query(`UPDATE prioridad SET horas_respuesta = $2, horas_solucion = $3 WHERE id_prioridad = $1`, [f.id_prioridad, f.horas_respuesta, f.horas_solucion]);
      }
    });
    await auditar(req, 'EDITAR', 'prioridad', 'SLA', undefined, filas);
    res.json({ ok: true });
  }),
);
