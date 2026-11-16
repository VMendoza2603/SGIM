-- =====================================================================
--  SGIM · Datos de demostración (los mismos casos del prototipo)
--  Solo para desarrollo. Ejecutar con:  npm run db:demo  (carpeta backend)
--  Las fechas son relativas a now() para que los plazos (SLA) se vean como en el prototipo.
-- =====================================================================
SET search_path TO sgim, public;

DO $$
DECLARE
  v_maria  BIGINT := (SELECT id_usuario FROM usuario WHERE telefono_wa = '593900000004');
  v_kevin  BIGINT := (SELECT id_usuario FROM usuario WHERE telefono_wa = '593900000005');
  v_rosa   BIGINT;
  v_coord  BIGINT := (SELECT id_usuario FROM usuario WHERE correo = 'coordinador@sgim.test');
  v_luis   INT    := (SELECT t.id_tecnico FROM tecnico t JOIN usuario u USING (id_usuario) WHERE u.correo = 'lparedes@sgim.test');
  v_andrea INT    := (SELECT t.id_tecnico FROM tecnico t JOIN usuario u USING (id_usuario) WHERE u.correo = 'avillacis@sgim.test');
  e_pend SMALLINT := (SELECT id_estado FROM estado_incidente WHERE codigo='PENDIENTE');
  e_asig SMALLINT := (SELECT id_estado FROM estado_incidente WHERE codigo='ASIGNADO');
  e_proc SMALLINT := (SELECT id_estado FROM estado_incidente WHERE codigo='EN_PROCESO');
  e_veri SMALLINT := (SELECT id_estado FROM estado_incidente WHERE codigo='EN_VERIFICACION');
  e_reso SMALLINT := (SELECT id_estado FROM estado_incidente WHERE codigo='RESUELTO');
  p_alta SMALLINT := (SELECT id_prioridad FROM prioridad WHERE codigo='ALTA');
  p_med  SMALLINT := (SELECT id_prioridad FROM prioridad WHERE codigo='MEDIA');
  p_baja SMALLINT := (SELECT id_prioridad FROM prioridad WHERE codigo='BAJA');
  u_c102 INT := (SELECT id_ubicacion FROM ubicacion WHERE codigo='C-102');
  u_c201 INT := (SELECT id_ubicacion FROM ubicacion WHERE codigo='C-201');
  u_b204 INT := (SELECT id_ubicacion FROM ubicacion WHERE codigo='B-204');
  u_b101 INT := (SELECT id_ubicacion FROM ubicacion WHERE codigo='B-101');
  eq_ac  INT := (SELECT id_equipo FROM equipo WHERE codigo_inventario='AC-C102-01');
  eq_lu  INT := (SELECT id_equipo FROM equipo WHERE codigo_inventario='LU-B204-01');
  c_elec SMALLINT := (SELECT id_categoria FROM categoria WHERE codigo='ELEC');
  c_clim SMALLINT := (SELECT id_categoria FROM categoria WHERE codigo='CLIM');
  c_agua SMALLINT := (SELECT id_categoria FROM categoria WHERE codigo='AGUA');
  c_ilum SMALLINT := (SELECT id_categoria FROM categoria WHERE codigo='ILUM');
  c_segu SMALLINT := (SELECT id_categoria FROM categoria WHERE codigo='SEGU');
  c_mobi SMALLINT := (SELECT id_categoria FROM categoria WHERE codigo='MOBI');
  i BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM incidente) THEN
    RAISE NOTICE 'Ya hay incidentes cargados; no se insertan datos de demostración.';
    RETURN;
  END IF;

  INSERT INTO usuario (id_rol, cedula, nombres, apellidos, telefono_wa, tipo_miembro)
  VALUES (3, '0900000006', 'Rosa', 'Vera', '593900000006', 'ADMINISTRATIVO') RETURNING id_usuario INTO v_rosa;

  -- Historial antiguo del AC-C102-01 (alimenta la vista de historial y la alerta de preventivo)
  INSERT INTO incidente (codigo, id_reportante, titulo, descripcion, id_ubicacion, id_equipo, id_categoria, id_prioridad, id_estado, id_tecnico,
                         puntaje_prioridad, fecha_reporte, fecha_asignacion, fecha_resolucion, fecha_cierre, calificacion)
  VALUES ('INC-2026-000098', v_kevin, 'No enciende', 'El aire del lab 2 no enciende', u_c102, eq_ac, c_clim, p_med, e_reso, v_luis, 45,
          now() - interval '87 days', now() - interval '87 days', now() - interval '86 days' + interval '6 hours', now() - interval '86 days', 4)
  RETURNING id_incidente INTO i;
  INSERT INTO accion_mantenimiento (id_incidente, id_tecnico, tipo, descripcion) VALUES (i, v_luis, 'CORRECTIVA', 'Reemplazo del capacitor');

  INSERT INTO incidente (codigo, id_reportante, titulo, descripcion, id_ubicacion, id_equipo, id_categoria, id_prioridad, id_estado, id_tecnico,
                         puntaje_prioridad, fecha_reporte, fecha_asignacion, fecha_resolucion, fecha_cierre, calificacion)
  VALUES ('INC-2026-000121', v_maria, 'Gotea agua', 'El aire acondicionado gotea sobre el puesto 3', u_c102, eq_ac, c_clim, p_med, e_reso, v_luis, 45,
          now() - interval '41 days', now() - interval '41 days', now() - interval '41 days' + interval '6 hours', now() - interval '41 days' + interval '7 hours', 5)
  RETURNING id_incidente INTO i;
  INSERT INTO accion_mantenimiento (id_incidente, id_tecnico, tipo, descripcion) VALUES (i, v_luis, 'CORRECTIVA', 'Destape de la manguera de drenaje');

  -- 144 · Pupitre (resuelto)
  INSERT INTO incidente (codigo, id_reportante, titulo, descripcion, id_ubicacion, id_categoria, id_prioridad, id_estado, id_tecnico,
                         puntaje_prioridad, diagnostico_preliminar, fecha_reporte, fecha_asignacion, fecha_inicio_atencion, fecha_resolucion, fecha_cierre, calificacion)
  VALUES ('INC-2026-000144', v_kevin, 'Pupitre con soporte roto', 'El pupitre del aula B-101 tiene el soporte roto', u_b101, c_mobi, p_baja, e_reso, v_andrea, 5,
          'Soporte metálico del pupitre fracturado. Se recomienda soldar o reemplazar la pieza.',
          now() - interval '5 days', now() - interval '5 days', now() - interval '4 days 20 hours', now() - interval '4 days 18 hours', now() - interval '4 days 16 hours', 5)
  RETURNING id_incidente INTO i;
  INSERT INTO asignacion (id_incidente, id_tecnico, automatica, motivo, activa, asignado_en) VALUES (i, v_andrea, TRUE, 'Menor carga en Mobiliario', FALSE, now() - interval '5 days');
  INSERT INTO accion_mantenimiento (id_incidente, id_tecnico, tipo, descripcion) VALUES (i, v_andrea, 'CORRECTIVA', 'Soldadura del soporte y ajuste de tornillos');
  INSERT INTO incidente_regla VALUES (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Categoría Mobiliario'), 5);

  -- 143 · Cerradura (asignado, plazo vencido)
  INSERT INTO incidente (codigo, id_reportante, titulo, descripcion, id_ubicacion, id_categoria, id_prioridad, id_estado, id_tecnico,
                         puntaje_prioridad, diagnostico_preliminar, afecta_clases, fecha_reporte, fecha_asignacion)
  VALUES ('INC-2026-000143', v_rosa, 'Cerradura dañada', 'La cerradura del laboratorio de química no cierra', u_c201, c_segu, p_med, e_asig, v_andrea, 55,
          'Cerradura de pomo con el cilindro desgastado; la puerta queda sin seguro. Reemplazar el cilindro.', TRUE,
          now() - interval '3 days 2 hours', now() - interval '3 days 2 hours')
  RETURNING id_incidente INTO i;
  INSERT INTO asignacion (id_incidente, id_tecnico, automatica, motivo, asignado_en) VALUES (i, v_andrea, TRUE, 'Menor carga en Seguridad', now() - interval '3 days 2 hours');
  INSERT INTO incidente_regla VALUES
    (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Categoría Seguridad'), 25),
    (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Impide el desarrollo de clases'), 20),
    (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Ubicación crítica (lab./auditorio)'), 10);

  -- 145 · Luminaria (en verificación)
  INSERT INTO incidente (codigo, id_reportante, titulo, descripcion, id_ubicacion, id_equipo, id_categoria, id_prioridad, id_estado, id_tecnico,
                         puntaje_prioridad, diagnostico_preliminar, afecta_clases, fecha_reporte, fecha_asignacion, fecha_inicio_atencion, fecha_resolucion)
  VALUES ('INC-2026-000145', v_maria, 'Luminaria parpadea', 'La lámpara del aula 2.º B parpadea toda la clase', u_b204, eq_lu, c_ilum, p_baja, e_veri, v_luis, 30,
          'Panel LED con parpadeo intermitente; probable falla del driver.', TRUE,
          now() - interval '3 days', now() - interval '3 days', now() - interval '6 hours', now() - interval '2 hours')
  RETURNING id_incidente INTO i;
  INSERT INTO asignacion (id_incidente, id_tecnico, automatica, motivo, asignado_en, aceptada_en) VALUES (i, v_luis, TRUE, 'Menor carga en Iluminación', now() - interval '3 days', now() - interval '6 hours');
  INSERT INTO accion_mantenimiento (id_incidente, id_tecnico, tipo, descripcion, materiales) VALUES (i, v_luis, 'CORRECTIVA', 'Reemplazo del driver LED de 40 W', 'Driver LED 40 W');
  INSERT INTO evidencia (id_incidente, id_subido_por, tipo, url_archivo, mime_type, descripcion, creado_en) VALUES
    (i, v_maria, 'REPORTE', '/uploads/demo-145-antes.png', 'image/png', 'Panel LED con 2 tubos apagados', now() - interval '3 days'),
    (i, (SELECT id_usuario FROM tecnico WHERE id_tecnico = v_luis), 'CIERRE', '/uploads/demo-145-despues.png', 'image/png', 'Panel LED encendido completo', now() - interval '2 hours');
  INSERT INTO analisis_ia (id_incidente, tipo, modelo, confianza, interpretacion)
  VALUES (i, 'VERIFICACION_CIERRE', 'demo', 0.88, 'La luminaria aparece encendida de forma uniforme. Coincide con la ubicación del reporte.');
  INSERT INTO verificacion_cierre (id_incidente, id_evidencia, resultado_ia, confianza_ia, confirmacion_reportante)
  VALUES (i, (SELECT id_evidencia FROM evidencia WHERE id_incidente = i AND tipo = 'CIERRE'), 'APROBADA', 0.88, TRUE);
  INSERT INTO incidente_regla VALUES
    (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Categoría Iluminación'), 10),
    (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Impide el desarrollo de clases'), 20);

  -- 146 · Fuga (pendiente, revisión manual: ubicación no reconocida)
  INSERT INTO incidente (codigo, id_reportante, titulo, descripcion, ubicacion_texto, id_categoria, id_prioridad, id_estado,
                         puntaje_prioridad, diagnostico_preliminar, fecha_reporte)
  VALUES ('INC-2026-000146', v_kevin, 'Fuga de agua en inodoro', 'Hay una fuga en el baño de abajo del bloque B, se está regando el agua',
          'baño de abajo del bloque B', c_agua, p_med, e_pend, 65,
          'Fuga activa en inodoro; posible falla de la válvula de llenado. Cerrar la llave de paso.', now() - interval '1 hour 40 minutes')
  RETURNING id_incidente INTO i;
  INSERT INTO analisis_ia (id_incidente, tipo, modelo, id_categoria_sugerida, confianza, anomalias, variables_riesgo, interpretacion)
  VALUES (i, 'TEXTO', 'demo', c_agua, 0.62, '["fuga activa"]', '{"fuga_activa": true}', 'Fuga de agua en un sanitario del bloque B. No se pudo identificar el código del baño.');
  INSERT INTO incidente_regla VALUES
    (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Fuga de agua activa / inundación'), 45),
    (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Categoría Agua'), 20);

  -- 147 · Aire acondicionado (en proceso)
  INSERT INTO incidente (codigo, id_reportante, titulo, descripcion, id_ubicacion, id_equipo, id_categoria, id_prioridad, id_estado, id_tecnico,
                         puntaje_prioridad, diagnostico_preliminar, afecta_clases, fecha_reporte, fecha_asignacion, fecha_inicio_atencion)
  VALUES ('INC-2026-000147', v_kevin, 'Aire acondicionado no enfría', 'El aire del lab 2 solo bota aire caliente desde ayer', u_c102, eq_ac, c_clim, p_med, e_proc, v_luis, 45,
          'Posible falta de refrigerante o filtro obstruido. Este equipo tiene 4 incidentes en 90 días y el mantenimiento preventivo está vencido.', TRUE,
          now() - interval '1 day 2 hours', now() - interval '1 day 2 hours', now() - interval '1 day 1 hour')
  RETURNING id_incidente INTO i;
  INSERT INTO asignacion (id_incidente, id_tecnico, automatica, motivo, asignado_en, aceptada_en) VALUES (i, v_luis, TRUE, 'Menor carga en Climatización', now() - interval '1 day 2 hours', now() - interval '1 day 1 hour');
  INSERT INTO accion_mantenimiento (id_incidente, id_tecnico, tipo, descripcion, canal, creado_en)
  VALUES (i, v_luis, 'DIAGNOSTICO', 'Presión de gas baja; filtros saturados.', 'WEB', now() - interval '1 day');
  INSERT INTO analisis_ia (id_incidente, tipo, modelo, id_categoria_sugerida, confianza, anomalias, interpretacion, tipo_equipo_detectado)
  VALUES (i, 'IMAGEN', 'demo', c_clim, 0.86, '["sin salida de aire frío"]', 'Split encendido sin condensación visible.', 'Aire acondicionado split');
  INSERT INTO evidencia (id_incidente, id_subido_por, tipo, url_archivo, mime_type, descripcion, creado_en)
  VALUES (i, v_kevin, 'REPORTE', '/uploads/demo-147-reporte.png', 'image/png', 'Split encendido', now() - interval '1 day 2 hours');
  INSERT INTO incidente_regla VALUES
    (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Categoría Climatización'), 15),
    (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Impide el desarrollo de clases'), 20),
    (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Ubicación crítica (lab./auditorio)'), 10);

  -- 148 · Tomacorriente (asignado, prioridad alta)
  INSERT INTO incidente (codigo, id_reportante, titulo, descripcion, id_ubicacion, id_categoria, id_prioridad, id_estado, id_tecnico,
                         puntaje_prioridad, diagnostico_preliminar, fecha_reporte, fecha_asignacion)
  VALUES ('INC-2026-000148', v_maria, 'Cable expuesto en tomacorriente',
          'Profe aquí en el lab de compu 2 hay un tomacorriente que está sacando chispa y tiene el cable pelado al lado del puesto 14',
          u_c102, c_elec, p_alta, e_asig, v_luis, 100,
          'Tomacorriente doble con carcasa fracturada y conductor sin aislamiento visible. Hay marcas de quemadura alrededor de la placa. Riesgo de descarga eléctrica para los estudiantes del puesto 14. Se recomienda cortar el circuito en el tablero del bloque C antes de intervenir.',
          now() - interval '58 minutes', now() - interval '57 minutes')
  RETURNING id_incidente INTO i;
  INSERT INTO asignacion (id_incidente, id_tecnico, automatica, motivo, asignado_en) VALUES (i, v_luis, TRUE, 'Menor carga en Electricidad', now() - interval '57 minutes');
  INSERT INTO evidencia (id_incidente, id_subido_por, tipo, url_archivo, mime_type, descripcion, creado_en)
  VALUES (i, v_maria, 'REPORTE', '/uploads/demo-148-reporte.png', 'image/png', 'Tomacorriente dañado', now() - interval '58 minutes');
  INSERT INTO analisis_ia (id_incidente, tipo, modelo, id_categoria_sugerida, confianza, anomalias, variables_riesgo, interpretacion, tipo_equipo_detectado)
  VALUES (i, 'IMAGEN', 'demo', c_elec, 0.94, '["cable expuesto", "marcas de quemadura", "placa rota"]', '{"riesgo_electrico": true}',
          'Tomacorriente doble con carcasa fracturada y conductor sin aislamiento visible.', 'Tomacorriente doble (sin código de inventario)');
  INSERT INTO incidente_regla VALUES
    (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Riesgo eléctrico visible'), 60),
    (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Categoría Electricidad'), 30),
    (i, (SELECT id_regla FROM regla_prioridad WHERE nombre='Ubicación crítica (lab./auditorio)'), 10);

  -- El trigger dejó un solo registro de historial por incidente con el estado actual; se completan los pasos previos.
  UPDATE historial_estado h SET creado_en = x.fecha_reporte FROM incidente x WHERE x.id_incidente = h.id_incidente AND x.id_estado = e_pend;
  INSERT INTO historial_estado (id_incidente, id_estado_anterior, id_estado_nuevo, canal, comentario, creado_en)
  SELECT x.id_incidente, NULL, e_pend, 'WHATSAPP', 'Creado por el agente IA', x.fecha_reporte FROM incidente x WHERE x.id_estado <> e_pend;
  DELETE FROM historial_estado h USING incidente x WHERE x.id_incidente = h.id_incidente AND x.id_estado <> e_pend AND h.id_estado_anterior IS NULL AND h.id_estado_nuevo = x.id_estado;
  INSERT INTO historial_estado (id_incidente, id_estado_anterior, id_estado_nuevo, canal, comentario, creado_en)
  SELECT x.id_incidente, e_pend, e_asig, 'SISTEMA', 'Asignación automática', x.fecha_asignacion FROM incidente x WHERE x.fecha_asignacion IS NOT NULL;
  INSERT INTO historial_estado (id_incidente, id_estado_anterior, id_estado_nuevo, canal, creado_en)
  SELECT x.id_incidente, e_asig, e_proc, 'WHATSAPP', x.fecha_inicio_atencion FROM incidente x WHERE x.fecha_inicio_atencion IS NOT NULL;
  INSERT INTO historial_estado (id_incidente, id_estado_anterior, id_estado_nuevo, canal, creado_en)
  SELECT x.id_incidente, e_proc, e_veri, 'WEB', x.fecha_resolucion FROM incidente x WHERE x.fecha_resolucion IS NOT NULL;
  INSERT INTO historial_estado (id_incidente, id_estado_anterior, id_estado_nuevo, canal, creado_en)
  SELECT x.id_incidente, e_veri, e_reso, 'WHATSAPP', x.fecha_cierre FROM incidente x WHERE x.fecha_cierre IS NOT NULL;

  -- Conversaciones de WhatsApp (A11)
  WITH c AS (
    INSERT INTO conversacion (id_usuario, telefono_wa, estado, iniciada_en, ultima_actividad)
    VALUES (v_kevin, '593900000005', 'ESPERANDO_UBICACION', now() - interval '1 hour 42 minutes', now() - interval '1 hour 40 minutes')
    RETURNING id_conversacion
  ), m AS (
    INSERT INTO mensaje (id_conversacion, direccion, tipo, contenido, estado, creado_en)
    SELECT c.id_conversacion, x.dir::direccion_mensaje, 'TEXTO', x.txt, 'LEIDO', now() - x.hace
      FROM c, (VALUES
        ('ENTRANTE', 'Hay una fuga en el baño de abajo del bloque B, se está regando el agua', interval '1 hour 42 minutes'),
        ('SALIENTE', 'Gracias, Kevin. ¿Me confirmas el código del baño? Por ejemplo B-1BH. También puedes enviarme una foto.', interval '1 hour 42 minutes'),
        ('ENTRANTE', 'no sé el código, es el de hombres', interval '1 hour 40 minutes')
      ) AS x(dir, txt, hace)
    RETURNING id_conversacion
  )
  UPDATE incidente SET id_conversacion = (SELECT id_conversacion FROM c) WHERE codigo = 'INC-2026-000146';

  WITH c AS (
    INSERT INTO conversacion (id_usuario, telefono_wa, estado, iniciada_en, ultima_actividad, cerrada_en)
    VALUES (v_maria, '593900000004', 'FINALIZADA', now() - interval '59 minutes', now() - interval '57 minutes', now() - interval '57 minutes')
    RETURNING id_conversacion
  ), m AS (
    INSERT INTO mensaje (id_conversacion, direccion, tipo, contenido, estado, creado_en)
    SELECT c.id_conversacion, x.dir::direccion_mensaje, x.tipo::tipo_mensaje, x.txt, 'LEIDO', now() - x.hace
      FROM c, (VALUES
        ('ENTRANTE', 'TEXTO', 'Hola, en el lab de compu 2 hay un tomacorriente sacando chispa y el cable está pelado al lado del puesto 14', interval '59 minutes'),
        ('ENTRANTE', 'IMAGEN', NULL, interval '59 minutes'),
        ('SALIENTE', 'TEXTO', 'Gracias, María. Entendí esto: Electricidad, tomacorriente con cable expuesto en C-102 · Laboratorio de Computación 2. Riesgo de descarga eléctrica. ¿Es correcto?', interval '58 minutes'),
        ('ENTRANTE', 'TEXTO', 'Sí, registrar', interval '58 minutes'),
        ('SALIENTE', 'TEXTO', 'Reporte registrado: INC-2026-000148, prioridad Alta. Un técnico ya fue notificado.', interval '57 minutes')
      ) AS x(dir, tipo, txt, hace)
    RETURNING id_conversacion
  )
  UPDATE incidente SET id_conversacion = (SELECT id_conversacion FROM c) WHERE codigo = 'INC-2026-000148';

  INSERT INTO conversacion (telefono_wa, estado, iniciada_en, ultima_actividad)
  VALUES ('593987654321', 'INICIO', now() - interval '1 day', now() - interval '1 day');
  INSERT INTO mensaje (id_conversacion, direccion, tipo, contenido, estado, creado_en)
  VALUES (currval('conversacion_id_conversacion_seq'), 'ENTRANTE', 'TEXTO', 'Buenas, ¿aquí se reportan daños?', 'LEIDO', now() - interval '1 day');

  PERFORM setval('seq_codigo_incidente', 148);
  UPDATE equipo SET ultimo_mantenimiento = current_date - 142, estado = 'CON_FALLA' WHERE id_equipo = eq_ac;
END $$;
