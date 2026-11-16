import { app } from './app.js';
import { config, whatsappActivo } from './config.js';
import { pool } from './db.js';
import { despacharPendientes } from './servicios/notificaciones.js';

await pool.query('SELECT 1');
app.listen(config.port, () => {
  console.log(`SGIM API escuchando en http://localhost:${config.port}`);
});

// Avisos de WhatsApp en cola (asignaciones, cambios de estado): se despachan cada 15 segundos
if (whatsappActivo()) {
  setInterval(() => void despacharPendientes(), 15_000);
  console.log('WhatsApp activo: despacho de avisos cada 15 s');
} else {
  console.log('WhatsApp sin configurar: el chatbot y los avisos están desactivados');
}
