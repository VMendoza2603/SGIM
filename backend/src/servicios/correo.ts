/**
 * Envío de correos (recuperación de contraseña) por Gmail con una «contraseña de aplicación».
 * Variables en backend/.env (y en Vercel): CORREO_USUARIO (la cuenta de Gmail) y CORREO_CLAVE_APP (16 letras).
 * Sin esas variables no se envía nada y el enlace se muestra en la consola del backend (modo desarrollo).
 */
import nodemailer from 'nodemailer';

const usuario = () => process.env.CORREO_USUARIO ?? '';
const clave = () => (process.env.CORREO_CLAVE_APP ?? '').replace(/\s+/g, ''); // Google la muestra con espacios
export const correoActivo = () => !!(usuario() && clave());

let transporte: nodemailer.Transporter | null = null;
function smtp() {
  transporte ??= nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: usuario(), pass: clave() },
    connectionTimeout: 10_000,
  });
  return transporte;
}

/** Dirección pública del panel para los enlaces de los correos (nunca se toma de la petición, para que no se pueda falsificar). */
export function urlPanel() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
}

export async function enviarCorreo(para: string, asunto: string, html: string, texto: string) {
  await smtp().sendMail({ from: `"SGIM · Mantenimiento" <${usuario()}>`, to: para, subject: asunto, html, text: texto });
}

const escapar = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Correo de recuperación de contraseña (P02), con los colores del SGIM. */
export function correoRecuperacion(nombre: string, enlace: string) {
  const n = escapar(nombre);
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f2f4f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e1e5ea">
<tr><td style="background:#1F3B57;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:bold">
<span style="background:#E8893A;border-radius:4px;padding:2px 6px;margin-right:8px">SG</span>SGIM</td></tr>
<tr><td style="padding:24px">
<h1 style="font-size:20px;margin:0 0 12px">Recupera tu contraseña</h1>
<p style="margin:0 0 12px;line-height:1.5">Hola ${n}, recibimos una solicitud para cambiar la contraseña de tu cuenta del panel de mantenimiento.</p>
<p style="margin:0 0 20px;line-height:1.5">Pulsa el botón para crear una nueva. El enlace vale <b>30 minutos</b> y solo se puede usar una vez.</p>
<p style="margin:0 0 20px"><a href="${enlace}" style="display:inline-block;background:#E8893A;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px">Crear nueva contraseña</a></p>
<p style="margin:0 0 6px;font-size:13px;color:#52606d">Si el botón no funciona, copia esta dirección en tu navegador:</p>
<p style="margin:0 0 20px;font-size:13px;word-break:break-all"><a href="${enlace}" style="color:#1F3B57">${enlace}</a></p>
<p style="margin:0;font-size:13px;color:#52606d">Si tú no lo pediste, ignora este correo: tu contraseña no cambiará.</p>
</td></tr>
<tr><td style="padding:14px 24px;background:#f7f8fa;font-size:12px;color:#7b8794">Sistema de Gestión de Incidentes de Mantenimiento · Unidad Educativa</td></tr>
</table></td></tr></table></body></html>`;
  const texto = `Hola ${nombre}:\n\nRecibimos una solicitud para cambiar la contraseña de tu cuenta del SGIM.\nAbre este enlace para crear una nueva (vale 30 minutos y se usa una sola vez):\n\n${enlace}\n\nSi tú no lo pediste, ignora este correo.`;
  return { asunto: 'SGIM · Recupera tu contraseña', html, texto };
}
