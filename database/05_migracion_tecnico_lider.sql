-- =============================================================================
-- Migración 05 · Técnico líder (pedido de la tutoría, 2026-11-15)
--   El técnico ya no decide si acepta o rechaza un incidente: no tiene esa autoridad.
--   Un técnico líder (uno solo, lo designa el coordinador) recibe por WhatsApp todos los reportes
--   con la asignación que hizo el sistema y puede cambiar el técnico. Los demás técnicos solo
--   reciben un aviso informativo y atienden desde su panel.
-- Idempotente: se puede ejecutar varias veces.
-- =============================================================================
SET search_path TO sgim, public;

ALTER TABLE tecnico ADD COLUMN IF NOT EXISTS es_lider BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN tecnico.es_lider IS
  'Técnico líder: recibe todos los reportes y puede reasignarlos. Solo uno a la vez; lo cambia el coordinador.';

-- Solo puede haber un técnico líder
CREATE UNIQUE INDEX IF NOT EXISTS ux_tecnico_un_lider ON tecnico (es_lider) WHERE es_lider;

-- El técnico ya no puede rechazar la asignación (ASIGNADO → PENDIENTE para el rol TECNICO)
DELETE FROM transicion_estado te
 USING estado_incidente eo, estado_incidente ed, rol r
 WHERE te.id_estado_origen = eo.id_estado AND eo.codigo = 'ASIGNADO'
   AND te.id_estado_destino = ed.id_estado AND ed.codigo = 'PENDIENTE'
   AND te.id_rol = r.id_rol AND r.codigo = 'TECNICO';
