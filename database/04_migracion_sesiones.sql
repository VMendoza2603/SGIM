-- =====================================================================
--  SGIM · Migración 04: cierre de sesión en todos los dispositivos
--  Los tokens emitidos antes de usuario.sesiones_desde dejan de ser válidos.
-- =====================================================================
SET search_path TO sgim, public;

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS sesiones_desde TIMESTAMPTZ;

COMMENT ON COLUMN usuario.sesiones_desde IS
  'Tokens JWT emitidos antes de esta fecha se rechazan (cerrar sesión en todos los dispositivos / cambio de contraseña)';
