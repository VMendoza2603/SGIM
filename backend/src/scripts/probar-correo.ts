/**
 * Prueba el envío de correo sin pasar por el panel:  npm run correo:probar -- tu.correo@ejemplo.com
 * Usa CORREO_USUARIO y CORREO_CLAVE_APP de backend/.env y manda el mismo correo de recuperación (con un enlace de ejemplo).
 */
import 'dotenv/config';
import { correoActivo, correoRecuperacion, enviarCorreo, urlPanel } from '../servicios/correo.js';

const destino = process.argv[2];
if (!destino) {
  console.error('Uso: npm run correo:probar -- tu.correo@ejemplo.com');
  process.exit(1);
}
if (!correoActivo()) {
  console.error('✖ Faltan CORREO_USUARIO o CORREO_CLAVE_APP en backend/.env');
  process.exit(1);
}
const c = correoRecuperacion('(prueba)', `${urlPanel()}/restablecer?token=ENLACE-DE-PRUEBA`);
try {
  await enviarCorreo(destino, `${c.asunto} (prueba)`, c.html, c.texto);
  console.log(`✔ Correo enviado a ${destino}. Revisa la bandeja de entrada (y la carpeta Spam).`);
} catch (e) {
  const m = (e as Error).message;
  console.error(`✖ No se pudo enviar: ${m}`);
  if (/535|Username and Password not accepted|BadCredentials/i.test(m)) {
    console.error('  Gmail rechazó el usuario o la clave. Usa una «contraseña de aplicación» (no tu contraseña normal) y revisa que la verificación en 2 pasos esté activa.');
  }
  process.exit(1);
}
