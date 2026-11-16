// Función serverless de Vercel: todas las rutas /api/* llegan aquí (ver vercel.json)
// y las atiende la misma aplicación Express del backend, ya compilada a JavaScript (backend/dist).
export { app as default } from '../backend/dist/app.js';
