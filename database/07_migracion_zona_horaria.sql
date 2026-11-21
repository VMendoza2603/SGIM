-- =====================================================================
-- 07 · Zona horaria de Ecuador para la base (idempotente, sin cambios de tablas)
-- Las fechas se guardan como TIMESTAMPTZ (instante exacto); esto solo fija cómo se interpretan
-- los filtros por día ("Hoy", "desde/hasta" en Conversaciones, Reportes, Historial).
-- Sin esto, en Neon (que usa UTC) un mensaje de las 20:00 de Ecuador contaría como del día siguiente.
-- Aplica a las conexiones nuevas.
-- =====================================================================
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/Guayaquil');
END $$;
