-- =====================================================================
-- 08 · Bloques del campus UNEMI (solo datos, idempotente)
-- Agrega a la sede existente los bloques que aparecen en el mapa del campus (OpenStreetMap).
-- A, B y C ya existen y se dejan como están. No cambia el modelo de datos.
-- Para deshacer: DELETE FROM bloque WHERE codigo IN (...) AND no tenga ubicaciones.
-- =====================================================================
INSERT INTO bloque (id_sede, codigo, nombre, pisos)
SELECT s.id_sede, b.codigo, b.nombre, 1
  FROM (SELECT id_sede FROM sede ORDER BY id_sede LIMIT 1) s
 CROSS JOIN (VALUES
   ('D', 'Bloque D'), ('E', 'Bloque E'), ('F', 'Bloque F'), ('G', 'Bloque G'), ('H', 'Bloque H'),
   ('I', 'Bloque I'), ('J', 'Bloque J'), ('K', 'Bloque K'), ('L', 'Bloque L'), ('M', 'Bloque M'),
   ('N', 'Bloque N'), ('O', 'Bloque O'), ('P', 'Bloque P'), ('Q', 'Bloque Q'), ('R', 'Bloque R'),
   ('S', 'Bloque S'), ('T', 'Bloque T - FACI'), ('U', 'Bloque U'), ('V', 'Bloque V'), ('W', 'Bloque W'),
   ('X', 'Bloque X'),
   ('CRAI', 'CRAI - Biblioteca'), ('POS', 'Posgrado'), ('POLI', 'Polideportivo'), ('MUC', 'MUC'),
   ('SIM', 'SIM'), ('CDIP', 'CDIP'), ('BIO', 'Biotecnología'), ('UNIBAR', 'Unibar')
 ) AS b(codigo, nombre)
ON CONFLICT (id_sede, codigo) DO NOTHING;
