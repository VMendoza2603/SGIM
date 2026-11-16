import { Router } from 'express';
import { z } from 'zod';
import { requierePermiso } from '../auth.js';
import { query, queryOne } from '../db.js';
import { HttpError, noEncontrado, ruta } from '../errores.js';
import { auditar } from '../servicios/auditoria.js';

export const infraestructuraRouter = Router();
const gestionaUbic = requierePermiso('ubicacion.gestionar');
const gestionaEq = requierePermiso('equipo.gestionar');

// ================================================================ A06 · Ubicaciones
infraestructuraRouter.get(
  '/ubicaciones',
  gestionaUbic,
  ruta(async (_req, res) => {
    const [sedes, bloques, ubicaciones, tipos] = await Promise.all([
      query(`SELECT id_sede, nombre, direccion, activo FROM sede ORDER BY nombre`),
      query(`SELECT id_bloque, id_sede, codigo, nombre, pisos, activo FROM bloque ORDER BY codigo`),
      query(
        `SELECT u.id_ubicacion, u.id_bloque, u.id_tipo_ubicacion, u.codigo, u.nombre, u.piso, u.capacidad, u.codigo_qr, u.activo,
                tu.nombre AS tipo, (SELECT count(*)::int FROM equipo e WHERE e.id_ubicacion = u.id_ubicacion AND e.activo) AS equipos
           FROM ubicacion u JOIN tipo_ubicacion tu ON tu.id_tipo_ubicacion = u.id_tipo_ubicacion ORDER BY u.codigo`,
      ),
      query(`SELECT id_tipo_ubicacion AS id, nombre, criticidad FROM tipo_ubicacion ORDER BY nombre`),
    ]);
    res.json({ sedes, bloques, ubicaciones, tipos });
  }),
);

const sedeSchema = z.object({ nombre: z.string().trim().min(3).max(120), direccion: z.string().trim().max(255).nullable().optional() });
infraestructuraRouter.post(
  '/sedes',
  gestionaUbic,
  ruta(async (req, res) => {
    const b = sedeSchema.parse(req.body);
    const s = await queryOne(`INSERT INTO sede (nombre, direccion) VALUES ($1,$2) RETURNING id_sede`, [b.nombre, b.direccion ?? null]);
    await auditar(req, 'CREAR', 'sede', s!.id_sede, undefined, b);
    res.status(201).json(s);
  }),
);

const bloqueSchema = z.object({
  id_sede: z.number().int(),
  codigo: z.string().trim().min(1).max(20),
  nombre: z.string().trim().min(3).max(120),
  pisos: z.number().int().min(1).max(50),
});
infraestructuraRouter.post(
  '/bloques',
  gestionaUbic,
  ruta(async (req, res) => {
    const b = bloqueSchema.parse(req.body);
    const r = await queryOne(`INSERT INTO bloque (id_sede, codigo, nombre, pisos) VALUES ($1,$2,$3,$4) RETURNING id_bloque`, [
      b.id_sede, b.codigo.toUpperCase(), b.nombre, b.pisos,
    ]);
    await auditar(req, 'CREAR', 'bloque', r!.id_bloque, undefined, b);
    res.status(201).json(r);
  }),
);

const ubicacionSchema = z.object({
  id_bloque: z.number().int(),
  id_tipo_ubicacion: z.number().int(),
  codigo: z.string().trim().min(1).max(30),
  nombre: z.string().trim().min(3).max(120),
  piso: z.number().int().min(0).max(50),
  capacidad: z.number().int().min(0).nullable().optional(),
  activo: z.boolean().default(true),
});

infraestructuraRouter.post(
  '/ubicaciones',
  gestionaUbic,
  ruta(async (req, res) => {
    const b = ubicacionSchema.parse(req.body);
    const codigo = b.codigo.toUpperCase();
    const r = await queryOne(
      `INSERT INTO ubicacion (id_bloque, id_tipo_ubicacion, codigo, nombre, piso, capacidad, codigo_qr)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id_ubicacion`,
      [b.id_bloque, b.id_tipo_ubicacion, codigo, b.nombre, b.piso, b.capacidad ?? null, `QR-${codigo.replace(/[^A-Z0-9]/g, '')}`],
    );
    await auditar(req, 'CREAR', 'ubicacion', r!.id_ubicacion, undefined, b);
    res.status(201).json(r);
  }),
);

infraestructuraRouter.put(
  '/ubicaciones/:id',
  gestionaUbic,
  ruta(async (req, res) => {
    const b = ubicacionSchema.parse(req.body);
    const antes = await queryOne(`SELECT * FROM ubicacion WHERE id_ubicacion = $1`, [req.params.id]);
    if (!antes) throw noEncontrado('Ubicación');
    await query(
      `UPDATE ubicacion SET id_bloque=$2, id_tipo_ubicacion=$3, codigo=$4, nombre=$5, piso=$6, capacidad=$7, activo=$8 WHERE id_ubicacion=$1`,
      [req.params.id, b.id_bloque, b.id_tipo_ubicacion, b.codigo.toUpperCase(), b.nombre, b.piso, b.capacidad ?? null, b.activo],
    );
    await auditar(req, 'EDITAR', 'ubicacion', req.params.id, antes, b);
    res.json({ ok: true });
  }),
);

// Baja lógica: una ubicación con incidentes nunca se borra, solo se desactiva (A06).
infraestructuraRouter.patch(
  '/ubicaciones/:id/activo',
  gestionaUbic,
  ruta(async (req, res) => {
    const { activo } = z.object({ activo: z.boolean() }).parse(req.body);
    await query(`UPDATE ubicacion SET activo = $2 WHERE id_ubicacion = $1`, [req.params.id, activo]);
    await auditar(req, activo ? 'ACTIVAR' : 'DESACTIVAR', 'ubicacion', req.params.id);
    res.json({ ok: true });
  }),
);

// ================================================================ A07 · Equipos
infraestructuraRouter.get(
  '/equipos',
  requierePermiso('equipo.ver'),
  ruta(async (req, res) => {
    const f = z.object({ q: z.string().trim().optional(), ubicacion: z.coerce.number().int().optional(), estado: z.string().optional() }).parse(req.query);
    const [equipos, tipos] = await Promise.all([
      query(
        `SELECT e.id_equipo, e.codigo_inventario, e.marca, e.modelo, e.numero_serie, e.estado, e.activo, e.fecha_instalacion, e.ultimo_mantenimiento,
                te.nombre AS tipo, c.nombre AS categoria, u.codigo AS ubicacion_codigo, u.nombre AS ubicacion,
                (SELECT count(*)::int FROM incidente i WHERE i.id_equipo = e.id_equipo) AS incidentes
           FROM equipo e
           JOIN tipo_equipo te ON te.id_tipo_equipo = e.id_tipo_equipo
           JOIN categoria c ON c.id_categoria = te.id_categoria
           JOIN ubicacion u ON u.id_ubicacion = e.id_ubicacion
          WHERE ($1::text IS NULL OR e.codigo_inventario ILIKE '%' || $1 || '%' OR te.nombre ILIKE '%' || $1 || '%' OR e.marca ILIKE '%' || $1 || '%')
            AND ($2::int IS NULL OR e.id_ubicacion = $2)
            AND ($3::text IS NULL OR e.estado::text = $3)
          ORDER BY e.activo DESC, e.codigo_inventario`,
        [f.q || null, f.ubicacion ?? null, f.estado || null],
      ),
      query(`SELECT te.id_tipo_equipo AS id, te.nombre, c.nombre AS categoria FROM tipo_equipo te JOIN categoria c USING (id_categoria) ORDER BY te.nombre`),
    ]);
    res.json({ equipos, tipos });
  }),
);

infraestructuraRouter.get(
  '/equipos/:codigo',
  requierePermiso('equipo.ver'),
  ruta(async (req, res) => {
    const e = await queryOne(
      `SELECT e.*, te.nombre AS tipo, te.frecuencia_preventivo_dias, c.nombre AS categoria, u.codigo AS ubicacion_codigo, u.nombre AS ubicacion
         FROM equipo e JOIN tipo_equipo te USING (id_tipo_equipo) JOIN categoria c ON c.id_categoria = te.id_categoria
         JOIN ubicacion u ON u.id_ubicacion = e.id_ubicacion
        WHERE e.codigo_inventario = $1`,
      [req.params.codigo],
    );
    if (!e) throw noEncontrado('Equipo');
    const incidentes = await query(
      `SELECT i.codigo, i.titulo, i.fecha_reporte, e.codigo AS estado,
              round(EXTRACT(EPOCH FROM (i.fecha_resolucion - i.fecha_reporte)) / 3600)::int AS horas_resolucion
         FROM incidente i JOIN estado_incidente e ON e.id_estado = i.id_estado
        WHERE i.id_equipo = $1 ORDER BY i.fecha_reporte DESC`,
      [e.id_equipo],
    );
    res.json({ ...e, incidentes });
  }),
);

const equipoSchema = z.object({
  id_tipo_equipo: z.number().int(),
  id_ubicacion: z.number().int(),
  codigo_inventario: z.string().trim().min(3).max(40),
  marca: z.string().trim().max(60).nullable().optional(),
  modelo: z.string().trim().max(60).nullable().optional(),
  numero_serie: z.string().trim().max(80).nullable().optional(),
  fecha_instalacion: z.string().date().nullable().optional(),
  ultimo_mantenimiento: z.string().date().nullable().optional(),
  estado: z.enum(['OPERATIVO', 'CON_FALLA', 'FUERA_DE_SERVICIO']).default('OPERATIVO'),
  observaciones: z.string().trim().nullable().optional(),
});
const valoresEquipo = (b: z.infer<typeof equipoSchema>) => [
  b.id_tipo_equipo, b.id_ubicacion, b.codigo_inventario.toUpperCase(), b.marca || null, b.modelo || null, b.numero_serie || null,
  b.fecha_instalacion || null, b.ultimo_mantenimiento || null, b.estado, b.observaciones || null,
];

infraestructuraRouter.post(
  '/equipos',
  gestionaEq,
  ruta(async (req, res) => {
    const b = equipoSchema.parse(req.body);
    const r = await queryOne(
      `INSERT INTO equipo (id_tipo_equipo, id_ubicacion, codigo_inventario, marca, modelo, numero_serie, fecha_instalacion, ultimo_mantenimiento, estado, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id_equipo, codigo_inventario`,
      valoresEquipo(b),
    );
    await auditar(req, 'CREAR', 'equipo', r!.id_equipo, undefined, b);
    res.status(201).json(r);
  }),
);

infraestructuraRouter.put(
  '/equipos/:id',
  gestionaEq,
  ruta(async (req, res) => {
    const b = equipoSchema.parse(req.body);
    const antes = await queryOne(`SELECT * FROM equipo WHERE id_equipo = $1`, [req.params.id]);
    if (!antes) throw noEncontrado('Equipo');
    if (!antes.activo) throw new HttpError(409, 'El equipo está dado de baja');
    await query(
      `UPDATE equipo SET id_tipo_equipo=$2, id_ubicacion=$3, codigo_inventario=$4, marca=$5, modelo=$6, numero_serie=$7,
              fecha_instalacion=$8, ultimo_mantenimiento=$9, estado=$10, observaciones=$11 WHERE id_equipo=$1`,
      [req.params.id, ...valoresEquipo(b)],
    );
    await auditar(req, 'EDITAR', 'equipo', req.params.id, antes, b);
    res.json({ ok: true });
  }),
);

// Un equipo con historial no se elimina: pasa a DADO_DE_BAJA (A07).
infraestructuraRouter.post(
  '/equipos/:id/baja',
  gestionaEq,
  ruta(async (req, res) => {
    const { motivo } = z.object({ motivo: z.string().trim().min(3) }).parse(req.body);
    const abiertos = await queryOne<{ n: number }>(
      `SELECT count(*)::int n FROM incidente i JOIN estado_incidente e ON e.id_estado = i.id_estado WHERE i.id_equipo = $1 AND NOT e.es_final`,
      [req.params.id],
    );
    if (abiertos!.n > 0) throw new HttpError(409, 'El equipo tiene incidentes abiertos. Ciérralos antes de darlo de baja.');
    await query(`UPDATE equipo SET estado = 'DADO_DE_BAJA', activo = FALSE, observaciones = concat_ws(' · ', observaciones, $2) WHERE id_equipo = $1`, [
      req.params.id,
      `Baja: ${motivo}`,
    ]);
    await auditar(req, 'DAR_DE_BAJA', 'equipo', req.params.id, undefined, { motivo });
    res.json({ ok: true });
  }),
);
