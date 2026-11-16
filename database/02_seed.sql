-- =====================================================================
--  SGIM · Datos iniciales (catálogos, permisos, reglas y datos de prueba)
--  Ejecutar después de 01_schema.sql
-- =====================================================================
SET search_path TO sgim, public;

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
INSERT INTO rol (id_rol, codigo, nombre, descripcion, acceso_web) VALUES
 (1, 'ADMIN',     'Administrador / Coordinador de mantenimiento',
     'Supervisa incidentes e historial y gestiona ubicaciones, equipos, técnicos, usuarios y reglas', TRUE),
 (2, 'TECNICO',   'Técnico de mantenimiento',
     'Atiende los incidentes que tiene asignados, registra acciones y sube la evidencia de cierre',   TRUE),
 (3, 'COMUNIDAD', 'Comunidad educativa',
     'Estudiantes, docentes y personal administrativo que reportan y consultan por WhatsApp',          FALSE);
SELECT setval('rol_id_rol_seq', 3);

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
INSERT INTO permiso (codigo, modulo, descripcion) VALUES
 ('dashboard.ver_general',      'Dashboard',     'Ver indicadores de toda la institución'),
 ('dashboard.ver_propio',       'Dashboard',     'Ver indicadores de los incidentes propios'),
 ('incidente.ver_todos',        'Incidentes',    'Ver todos los incidentes'),
 ('incidente.ver_asignados',    'Incidentes',    'Ver solo los incidentes asignados a uno mismo'),
 ('incidente.crear_web',        'Incidentes',    'Registrar un incidente desde el panel web'),
 ('incidente.reclasificar',     'Incidentes',    'Corregir categoría, prioridad, ubicación o equipo'),
 ('incidente.asignar',          'Incidentes',    'Asignar o reasignar técnico'),
 ('incidente.cambiar_estado',   'Incidentes',    'Cambiar estado según la máquina de estados'),
 ('incidente.registrar_accion', 'Incidentes',    'Registrar trabajos realizados'),
 ('incidente.subir_evidencia',  'Incidentes',    'Subir fotografías de avance y cierre'),
 ('incidente.verificar_cierre', 'Incidentes',    'Aprobar o rechazar el cierre de un incidente'),
 ('incidente.cancelar',         'Incidentes',    'Cancelar incidentes duplicados o improcedentes'),
 ('incidente.ver_analisis_ia',  'Incidentes',    'Ver el análisis y la confianza del agente de IA'),
 ('historial.ver',              'Historial',     'Consultar historial por ubicación y equipo'),
 ('conversacion.ver',           'WhatsApp',      'Ver conversaciones de WhatsApp'),
 ('ubicacion.gestionar',        'Infraestructura','Crear y editar sedes, bloques y ubicaciones'),
 ('equipo.ver',                 'Infraestructura','Consultar ficha de equipos'),
 ('equipo.gestionar',           'Infraestructura','Crear, editar y dar de baja equipos'),
 ('tecnico.gestionar',          'Personal',      'Gestionar técnicos, especialidades y zonas'),
 ('usuario.gestionar',          'Personal',      'Gestionar usuarios y roles'),
 ('regla.gestionar',            'Configuración', 'Configurar reglas de prioridad'),
 ('catalogo.gestionar',         'Configuración', 'Configurar categorías, prioridades y SLA'),
 ('parametro.gestionar',        'Configuración', 'Configurar parámetros del sistema y WhatsApp'),
 ('reporte.ver',                'Reportes',      'Ver y exportar reportes'),
 ('auditoria.ver',              'Seguridad',     'Consultar la bitácora de auditoría'),
 ('perfil.editar',              'Cuenta',        'Editar su perfil y contraseña'),
 ('disponibilidad.cambiar',     'Cuenta',        'Marcarse como disponible / no disponible'),
 ('wa.reportar',                'WhatsApp',      'Reportar incidentes por WhatsApp'),
 ('wa.consultar_propios',       'WhatsApp',      'Consultar el estado de sus reportes'),
 ('wa.confirmar_solucion',      'WhatsApp',      'Confirmar si el problema quedó solucionado y calificar'),
 ('wa.gestionar_asignados',     'WhatsApp',      'Aceptar, iniciar y cerrar incidentes asignados desde WhatsApp');

-- ADMIN: todo excepto los permisos exclusivos del canal de la comunidad/técnico
INSERT INTO rol_permiso (id_rol, id_permiso)
SELECT 1, id_permiso FROM permiso
 WHERE codigo NOT IN ('incidente.ver_asignados','dashboard.ver_propio','disponibilidad.cambiar',
                      'wa.reportar','wa.consultar_propios','wa.confirmar_solucion','wa.gestionar_asignados');

-- TECNICO
INSERT INTO rol_permiso (id_rol, id_permiso)
SELECT 2, id_permiso FROM permiso
 WHERE codigo IN ('dashboard.ver_propio','incidente.ver_asignados','incidente.cambiar_estado',
                  'incidente.registrar_accion','incidente.subir_evidencia','incidente.ver_analisis_ia',
                  'historial.ver','equipo.ver','perfil.editar','disponibilidad.cambiar',
                  'wa.gestionar_asignados');

-- COMUNIDAD (solo WhatsApp)
INSERT INTO rol_permiso (id_rol, id_permiso)
SELECT 3, id_permiso FROM permiso
 WHERE codigo IN ('wa.reportar','wa.consultar_propios','wa.confirmar_solucion');

-- ---------------------------------------------------------------------
-- Categorías (alcance aprobado)
-- ---------------------------------------------------------------------
INSERT INTO categoria (codigo, nombre, descripcion, peso_riesgo, icono, color_hex) VALUES
 ('ILUM', 'Iluminación',   'Luminarias, focos, lámparas, reflectores',               2, 'lightbulb', '#E0A100'),
 ('CLIM', 'Climatización', 'Aires acondicionados, ventiladores, extractores',        2, 'snowflake', '#2B8CC4'),
 ('ELEC', 'Electricidad',  'Tomacorrientes, breakers, tableros, cableado',           5, 'zap',       '#D2462F'),
 ('AGUA', 'Agua',          'Tuberías, grifería, sanitarios, filtraciones, cisternas',3, 'droplet',   '#1F9E89'),
 ('MOBI', 'Mobiliario',    'Pupitres, sillas, mesas, pizarras, puertas, ventanas',   1, 'armchair',  '#8A6A4F'),
 ('SEGU', 'Seguridad',     'Cerraduras, extintores, señalética, cámaras, cercas',    4, 'shield',    '#6B4FBB');

-- ---------------------------------------------------------------------
-- Prioridades y SLA
-- ---------------------------------------------------------------------
INSERT INTO prioridad (codigo, nombre, nivel, puntaje_min, puntaje_max, horas_respuesta, horas_solucion, color_hex) VALUES
 ('BAJA',  'Baja',  1,  0, 39,  24, 120, '#3C8D5A'),
 ('MEDIA', 'Media', 2, 40, 69,   8,  48, '#D99A1E'),
 ('ALTA',  'Alta',  3, 70, 999,  1,   8, '#C8372D');

-- ---------------------------------------------------------------------
-- Estados del incidente
-- ---------------------------------------------------------------------
INSERT INTO estado_incidente (id_estado, codigo, nombre, orden, es_final, visible_usuario) VALUES
 (1, 'PENDIENTE',       'Pendiente',            1, FALSE, 'Recibido, en espera de asignación'),
 (2, 'ASIGNADO',        'Asignado',             2, FALSE, 'Asignado a un técnico'),
 (3, 'EN_PROCESO',      'En proceso',           3, FALSE, 'El técnico está trabajando en tu reporte'),
 (4, 'EN_VERIFICACION', 'En verificación',      4, FALSE, 'Reparado, verificando la solución'),
 (5, 'RESUELTO',        'Resuelto',             5, TRUE,  'Solucionado'),
 (6, 'CANCELADO',       'Cancelado',            6, TRUE,  'Cancelado (duplicado o no procede)');
SELECT setval('estado_incidente_id_estado_seq', 6);

-- Máquina de estados (rol 1 = ADMIN, 2 = TECNICO, 3 = COMUNIDAD)
INSERT INTO transicion_estado (id_estado_origen, id_estado_destino, id_rol, requiere_evidencia, requiere_comentario) VALUES
 (1, 2, 1, FALSE, FALSE),   -- Coordinador asigna
 (1, 6, 1, FALSE, TRUE),    -- Coordinador cancela
 (2, 3, 2, FALSE, FALSE),   -- Técnico inicia atención
 (2, 3, 1, FALSE, FALSE),
 (2, 6, 1, FALSE, TRUE),
 (3, 4, 2, TRUE,  FALSE),   -- Técnico termina: exige foto de cierre
 (3, 6, 1, FALSE, TRUE),
 (4, 5, 1, FALSE, FALSE),   -- Coordinador aprueba el cierre
 (4, 3, 1, FALSE, TRUE),    -- Coordinador rechaza el cierre
 (4, 3, 3, FALSE, TRUE),    -- Reportante indica que no quedó solucionado
 (5, 3, 1, FALSE, TRUE);    -- Reapertura

-- ---------------------------------------------------------------------
-- Infraestructura de ejemplo
-- ---------------------------------------------------------------------
INSERT INTO tipo_ubicacion (nombre, criticidad) VALUES
 ('Aula', 3), ('Laboratorio', 4), ('Baño', 3), ('Oficina', 2),
 ('Auditorio', 4), ('Biblioteca', 3), ('Pasillo / Área común', 2), ('Bar / Comedor', 3);

INSERT INTO sede (nombre, direccion) VALUES
 ('Unidad Educativa Milagro - Matriz', 'Av. 17 de Septiembre, Milagro');

INSERT INTO bloque (id_sede, codigo, nombre, pisos) VALUES
 (1, 'A', 'Bloque A - Administración', 2),
 (1, 'B', 'Bloque B - Aulas',          3),
 (1, 'C', 'Bloque C - Laboratorios',   2);

INSERT INTO ubicacion (id_bloque, id_tipo_ubicacion, codigo, nombre, piso, capacidad, codigo_qr) VALUES
 (1, 4, 'A-101', 'Secretaría general',        1, 8,  'QR-A101'),
 (1, 5, 'A-201', 'Auditorio principal',       2, 180,'QR-A201'),
 (2, 1, 'B-101', 'Aula 1.º Bachillerato A',   1, 40, 'QR-B101'),
 (2, 1, 'B-204', 'Aula 2.º Bachillerato B',   2, 40, 'QR-B204'),
 (2, 3, 'B-1BH', 'Baño hombres planta baja',  1, NULL,'QR-B1BH'),
 (3, 2, 'C-102', 'Laboratorio de Computación 2', 1, 30,'QR-C102'),
 (3, 2, 'C-201', 'Laboratorio de Química',    2, 25, 'QR-C201');

INSERT INTO tipo_equipo (id_categoria, nombre, vida_util_meses, frecuencia_preventivo_dias) VALUES
 (1, 'Luminaria LED de panel',      60, 180),
 (2, 'Aire acondicionado split',    96,  90),
 (2, 'Ventilador de techo',         60, 180),
 (3, 'Tablero eléctrico',          240, 365),
 (3, 'Tomacorriente doble',        120, NULL),
 (4, 'Lavamanos',                  180, NULL),
 (4, 'Inodoro',                    180, NULL),
 (5, 'Pupitre unipersonal',         84, NULL),
 (5, 'Pizarra acrílica',            84, NULL),
 (6, 'Extintor PQS',                60, 365),
 (6, 'Cerradura de puerta',        120, NULL);

INSERT INTO equipo (id_tipo_equipo, id_ubicacion, codigo_inventario, marca, modelo, fecha_instalacion) VALUES
 (2, 6, 'AC-C102-01', 'LG',       'S4-Q24K', '2022-03-10'),
 (2, 6, 'AC-C102-02', 'LG',       'S4-Q24K', '2022-03-10'),
 (1, 4, 'LU-B204-01', 'Sylvania', 'P60x60',  '2023-01-15'),
 (1, 4, 'LU-B204-02', 'Sylvania', 'P60x60',  '2023-01-15'),
 (4, 3, 'TB-B1-01',   'Schneider','Easy9',   '2019-08-01'),
 (7, 5, 'IN-B1BH-01', 'Edesa',    'Rapid',   '2020-05-20'),
 (10,7, 'EX-C201-01', 'Amerex',   'B500',    '2025-02-01');

-- ---------------------------------------------------------------------
-- Reglas de prioridad (puntaje 0-100+)
-- ---------------------------------------------------------------------
INSERT INTO regla_prioridad (nombre, variable, operador, valor, puntos, forzar_prioridad, orden) VALUES
 ('Riesgo eléctrico visible',             'riesgo_electrico',  '=',  'true', 60, 3, 10),
 ('Fuga de agua activa / inundación',     'fuga_activa',       '=',  'true', 45, NULL, 20),
 ('Riesgo para la integridad de personas','riesgo_personas',   '=',  'true', 70, 3, 5),
 ('Categoría Electricidad',               'categoria',         '=',  'ELEC', 30, NULL, 30),
 ('Categoría Seguridad',                  'categoria',         '=',  'SEGU', 25, NULL, 30),
 ('Categoría Agua',                       'categoria',         '=',  'AGUA', 20, NULL, 30),
 ('Categoría Climatización',              'categoria',         '=',  'CLIM', 15, NULL, 30),
 ('Categoría Iluminación',                'categoria',         '=',  'ILUM', 10, NULL, 30),
 ('Categoría Mobiliario',                 'categoria',         '=',  'MOBI',  5, NULL, 30),
 ('Impide el desarrollo de clases',       'afecta_clases',     '=',  'true', 20, NULL, 40),
 ('Ubicación crítica (lab./auditorio)',   'criticidad_ubicacion','>=','4',   10, NULL, 50),
 ('Afecta a más de 20 personas',          'personas_afectadas','>',  '20',   10, NULL, 60),
 ('Reincidencia: 3+ incidentes en 30 días','reincidencias_30d','>=', '3',    15, NULL, 70);

-- ---------------------------------------------------------------------
-- Parámetros del sistema
-- ---------------------------------------------------------------------
INSERT INTO parametro_sistema (clave, valor, tipo_dato, descripcion, editable) VALUES
 ('wa.phone_number_id',          '',      'TEXT',   'Phone Number ID de Meta Cloud API', TRUE),
 ('wa.mensaje_bienvenida',       'Hola 👋 Soy el asistente de mantenimiento. Cuéntame qué daño encontraste y, si puedes, envíame una foto.', 'TEXT', 'Saludo inicial del bot', TRUE),
 ('ia.modelo_texto',             '',      'TEXT',   'Modelo LLM para interpretar texto', TRUE),
 ('ia.modelo_vision',            '',      'TEXT',   'Modelo para analizar imágenes', TRUE),
 ('ia.umbral_confianza',         '0.70',  'DECIMAL','Bajo este valor el incidente queda para revisión manual', TRUE),
 ('asignacion.automatica',       'true',  'BOOL',   'Asignar automáticamente al técnico con menor carga', TRUE),
 ('verificacion.umbral_ia',      '0.80',  'DECIMAL','Confianza mínima para que la IA apruebe la foto de cierre', TRUE),
 ('verificacion.horas_confirmar','24',    'INT',    'Horas que tiene el reportante para confirmar la solución', TRUE),
 ('seguridad.max_intentos_login','5',     'INT',    'Intentos fallidos antes de bloquear la cuenta', TRUE),
 ('seguridad.minutos_bloqueo',   '15',    'INT',    'Minutos de bloqueo tras exceder los intentos', TRUE),
 ('archivo.max_mb',              '5',     'INT',    'Tamaño máximo de fotografías', TRUE);

-- ---------------------------------------------------------------------
-- Usuarios de prueba (solo para entorno de desarrollo)
-- Contraseña de los usuarios web: Sgim2026*  (se exige cambio en el primer ingreso)
-- ---------------------------------------------------------------------
INSERT INTO usuario (id_rol, cedula, nombres, apellidos, correo, telefono_wa, password_hash, tipo_miembro) VALUES
 (1, '0900000001', 'Coordinador',  'Mantenimiento', 'coordinador@sgim.test', '593900000001', crypt('Sgim2026*', gen_salt('bf', 12)), NULL),
 (2, '0900000002', 'Luis',         'Paredes',       'lparedes@sgim.test',    '593900000002', crypt('Sgim2026*', gen_salt('bf', 12)), NULL),
 (2, '0900000003', 'Andrea',       'Villacís',      'avillacis@sgim.test',   '593900000003', crypt('Sgim2026*', gen_salt('bf', 12)), NULL),
 (3, '0900000004', 'María',        'Torres',        NULL,                    '593900000004', NULL, 'DOCENTE'),
 (3, '0900000005', 'Kevin',        'Salazar',       NULL,                    '593900000005', NULL, 'ESTUDIANTE');

INSERT INTO tecnico (id_usuario, turno) VALUES (2, 'MATUTINO'), (3, 'VESPERTINO');
INSERT INTO tecnico_categoria (id_tecnico, id_categoria, es_principal) VALUES
 (1, 3, TRUE), (1, 1, FALSE), (1, 2, FALSE),     -- Luis: electricidad, iluminación, climatización
 (2, 4, TRUE), (2, 5, FALSE), (2, 6, FALSE);     -- Andrea: agua, mobiliario, seguridad
INSERT INTO tecnico_bloque (id_tecnico, id_bloque) VALUES (1,1),(1,2),(1,3),(2,1),(2,2),(2,3);

-- El técnico ya no rechaza asignaciones (lo decide el técnico líder): no existe la transición ASIGNADO → PENDIENTE para el rol 2.
-- El técnico líder (tecnico.es_lider) y el equipo técnico real del piloto se agregan en las migraciones 05 y 06,
-- que setup.ps1 ejecuta después de esta semilla.
