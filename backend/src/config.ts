import 'dotenv/config';

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre} en backend/.env`);
  return valor;
}

export const config = {
  databaseUrl: requerida('DATABASE_URL'),
  jwtSecret: requerida('JWT_SECRET'),
  port: Number(process.env.PORT ?? 3000),
  jwtExpira: '8h',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  /** Clave del endpoint /api/cron/notificaciones (reintentos de avisos en Vercel). */
  cronSecret: process.env.CRON_SECRET ?? '',
  /** WhatsApp Cloud API (fase 5). Si falta el token, el chatbot y los avisos quedan desactivados. */
  whatsapp: {
    token: process.env.WA_TOKEN ?? '',
    phoneNumberId: process.env.WA_PHONE_NUMBER_ID ?? '',
    verifyToken: process.env.WA_VERIFY_TOKEN ?? '',
    appSecret: process.env.WA_APP_SECRET ?? '',
    version: process.env.WA_API_VERSION ?? 'v25.0',
  },
  /** Agente de IA (fase 6): Gemini interpreta la foto y el texto del reporte y verifica la foto de cierre. */
  ia: {
    geminiKey: process.env.GEMINI_API_KEY ?? '',
    // Alias "-latest": Google los mantiene apuntando a la versión vigente (las versiones fijas se retiran)
    modelo: process.env.GEMINI_MODELO || 'gemini-flash-latest',
    // Respaldo: uno o varios modelos separados por coma, en orden (Google satura a veces dos modelos a la vez)
    modelosRespaldo: (process.env.GEMINI_MODELO_RESPALDO || 'gemini-flash-lite-latest,gemini-3.1-flash-lite')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
  },
};

export const whatsappActivo = () => !!(config.whatsapp.token && config.whatsapp.phoneNumberId);
export const iaActiva = () => !!config.ia.geminiKey;
