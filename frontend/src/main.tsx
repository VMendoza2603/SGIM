import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SesionProvider, useSesion } from './auth';
import { PrimerIngreso, Recuperar, Restablecer, SinAcceso } from './paginas/Acceso';
import { Atender } from './paginas/Atender';
import { Auditoria } from './paginas/Auditoria';
import { Bandeja } from './paginas/Bandeja';
import { Configuracion } from './paginas/Configuracion';
import { Conversaciones } from './paginas/Conversaciones';
import { Dashboard } from './paginas/Dashboard';
import { Detalle } from './paginas/Detalle';
import { Equipos, FichaEquipo } from './paginas/Equipos';
import { Historial } from './paginas/Historial';
import { Login } from './paginas/Login';
import { MisIncidentes } from './paginas/MisIncidentes';
import { NuevoIncidente } from './paginas/NuevoIncidente';
import { Perfil } from './paginas/Perfil';
import { Reglas } from './paginas/Reglas';
import { Reportes } from './paginas/Reportes';
import { TecnicoDetalle } from './paginas/TecnicoDetalle';
import { Tecnicos } from './paginas/Tecnicos';
import { Ubicaciones } from './paginas/Ubicaciones';
import { Usuarios } from './paginas/Usuarios';
import { Verificaciones } from './paginas/Verificaciones';
import { Shell } from './Shell';
import { aplicarPreferencias, Cargando } from './ui';
import './styles.css';

// Modo claro/oscuro y tamaño de letra guardados en este navegador (antes de dibujar, para que no parpadee)
aplicarPreferencias();

/** Exige sesión; si la contraseña es temporal, manda al cambio obligatorio (P03). */
function Privado({ children }: { children: ReactNode }) {
  const { usuario, cargando } = useSesion();
  if (cargando) return <Cargando />;
  if (!usuario) return <Navigate to="/login" replace />;
  if (usuario.debeCambiarPwd) return <Navigate to="/primer-ingreso" replace />;
  return <>{children}</>;
}

/** Sin el permiso, muestra el 403 (P04) en lugar de la pantalla. */
function Con({ permiso, children }: { permiso: string | string[]; children: ReactNode }) {
  const { puede } = useSesion();
  return puede(...([] as string[]).concat(permiso)) ? <>{children}</> : <SinAcceso />;
}

function Inicio() {
  const { usuario } = useSesion();
  return usuario?.rol === 'TECNICO' ? <Navigate to="/mis-incidentes" replace /> : <Con permiso="dashboard.ver_general"><Dashboard /></Con>;
}

/** Ruta → [permiso, pantalla]. El menú (Shell.MENU) usa los mismos permisos. */
const RUTAS: [string, string | string[], ReactNode][] = [
  ['/incidentes', 'incidente.ver_todos', <Bandeja />],
  ['/incidentes/nuevo', 'incidente.crear_web', <NuevoIncidente />],
  ['/incidentes/:codigo', 'incidente.ver_todos', <Detalle />],
  ['/verificaciones', 'incidente.verificar_cierre', <Verificaciones />],
  ['/historial', 'historial.ver', <Historial />],
  ['/ubicaciones', 'ubicacion.gestionar', <Ubicaciones />],
  ['/equipos', 'equipo.gestionar', <Equipos />],
  ['/equipos/:codigo', 'equipo.ver', <FichaEquipo />],
  ['/tecnicos', 'tecnico.gestionar', <Tecnicos />],
  ['/tecnicos/:id', 'tecnico.gestionar', <TecnicoDetalle />],
  ['/usuarios', 'usuario.gestionar', <Usuarios />],
  ['/conversaciones', 'conversacion.ver', <Conversaciones />],
  ['/reglas', 'regla.gestionar', <Reglas />],
  ['/reportes', 'reporte.ver', <Reportes />],
  ['/configuracion', ['parametro.gestionar', 'catalogo.gestionar'], <Configuracion />],
  ['/auditoria', 'auditoria.ver', <Auditoria />],
  ['/perfil', 'perfil.editar', <Perfil />],
  ['/mis-incidentes', 'incidente.ver_asignados', <MisIncidentes />],
  ['/mis-incidentes/:codigo', 'incidente.ver_asignados', <Atender />],
];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SesionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/recuperar" element={<Recuperar />} />
          <Route path="/restablecer" element={<Restablecer />} />
          <Route path="/primer-ingreso" element={<PrimerIngreso />} />
          <Route element={<Privado><Shell /></Privado>}>
            <Route index element={<Inicio />} />
            {RUTAS.map(([ruta, permiso, pantalla]) => (
              <Route key={ruta} path={ruta} element={<Con permiso={permiso}>{pantalla}</Con>} />
            ))}
            <Route path="*" element={<SinAcceso noExiste />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SesionProvider>
  </StrictMode>,
);
