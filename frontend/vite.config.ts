import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Permite abrir el panel desde el celular por un túnel temporal: cloudflared (cloudflared tunnel --url http://localhost:5173)
    // o el reenvío de puertos de VS Code (pestaña Puertos, usa Dev Tunnels)
    allowedHosts: ['.trycloudflare.com', '.devtunnels.ms'],
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
});
