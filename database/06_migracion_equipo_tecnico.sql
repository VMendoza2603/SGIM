-- =============================================================================
-- Migración 06 · Equipo técnico real del piloto (2026-11-15)
--   Victor Mendoza, técnico líder. (Alberto Rodríguez queda como comunidad para probar el chatbot como reportante.)
--   Si su número ya escribió al chatbot como comunidad, ese mismo usuario pasa a técnico
--   (conserva sus reportes). Contraseña temporal: la misma de los usuarios de prueba (02_seed.sql);
--   el sistema exige cambiarla en el primer ingreso.
-- Idempotente: se puede ejecutar varias veces sin duplicar nada.
-- =============================================================================
SET search_path TO sgim, public;

-- 1. Usuario: se crea o se convierte a técnico
INSERT INTO usuario (id_rol, nombres, apellidos, correo, telefono_wa, password_hash)
SELECT r.id_rol, d.nombres, d.apellidos, d.correo, d.telefono, crypt('Sgim2026*', gen_salt('bf', 12))
  FROM rol r,
       (VALUES ('Victor', 'Mendoza', 'edumendoza.2031@gmail.com', '593979838115')) AS d(nombres, apellidos, correo, telefono)
 WHERE r.codigo = 'TECNICO'
ON CONFLICT (telefono_wa) DO UPDATE
   SET id_rol = EXCLUDED.id_rol, nombres = EXCLUDED.nombres, apellidos = EXCLUDED.apellidos, correo = EXCLUDED.correo,
       tipo_miembro = NULL, activo = TRUE,
       -- Solo se pone la contraseña temporal si todavía no tenía una (no pisa la que ya cambió)
       password_hash = COALESCE(usuario.password_hash, EXCLUDED.password_hash),
       debe_cambiar_pwd = CASE WHEN usuario.password_hash IS NULL THEN TRUE ELSE usuario.debe_cambiar_pwd END;

-- 2. Ficha de técnico (turno, cupo)
INSERT INTO tecnico (id_usuario, turno, max_activos)
SELECT u.id_usuario, d.turno, 5
  FROM usuario u JOIN (VALUES ('593979838115', 'COMPLETO')) AS d(telefono, turno) ON u.telefono_wa = d.telefono
ON CONFLICT (id_usuario) DO NOTHING;

-- 3. Especialidades: atiende todas las categorías (principal: Electricidad). Sin zonas = todos los bloques.
INSERT INTO tecnico_categoria (id_tecnico, id_categoria, es_principal)
SELECT t.id_tecnico, c.id_categoria, c.codigo = d.principal
  FROM tecnico t JOIN usuario u ON u.id_usuario = t.id_usuario
  JOIN (VALUES ('593979838115', 'ELEC')) AS d(telefono, principal) ON u.telefono_wa = d.telefono
 CROSS JOIN categoria c
ON CONFLICT DO NOTHING;

-- 4. Victor es el técnico líder (solo si todavía no hay otro designado por el coordinador)
UPDATE tecnico t SET es_lider = TRUE
  FROM usuario u
 WHERE u.id_usuario = t.id_usuario AND u.telefono_wa = '593979838115'
   AND NOT EXISTS (SELECT 1 FROM tecnico x WHERE x.es_lider);
