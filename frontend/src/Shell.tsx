import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import { useSesion } from './auth';
import { iniciales, useIntervalo, usePreferencias } from './ui';

type Alerta = { codigo: string; titulo: string; nivel: 'bad' | 'warn' | 'info'; motivo: string };

/** Campana: lo que necesita atención (plazos, revisión manual, cierres por aprobar, nuevas asignaciones). */
function Campana({ esTecnico }: { esTecnico: boolean }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [abierta, setAbierta] = useState(false);
  const cargar = () =>
    api<Alerta[]>('/alertas')
      .then(setAlertas)
      .catch(() => undefined);
  useEffect(() => {
    cargar();
    setAbierta(false);
  }, [pathname]);
  useIntervalo(() => void cargar(), 15000);
  useEffect(() => {
    if (!abierta) return;
    const cerrar = (e: KeyboardEvent) => e.key === 'Escape' && setAbierta(false);
    window.addEventListener('keydown', cerrar);
    return () => window.removeEventListener('keydown', cerrar);
  }, [abierta]);

  return (
    <div className="menu">
      <button
        type="button"
        className="icono"
        aria-label={`Alertas: ${alertas.length}`}
        aria-expanded={abierta}
        title="Alertas"
        onClick={() => setAbierta(!abierta)}
      >
        🔔{alertas.length > 0 && <b>{alertas.length > 99 ? '99+' : alertas.length}</b>}
      </button>
      {abierta && (
        <div className="alertas" role="dialog" aria-label="Alertas">
          <h4>Alertas</h4>
          {alertas.length === 0 ? (
            <div className="empty">Todo al día 👍</div>
          ) : (
            alertas.map((a, i) => (
              <button
                key={`${a.codigo}-${i}`}
                className={a.nivel}
                onClick={() => navigate(`${esTecnico ? '/mis-incidentes' : '/incidentes'}/${a.codigo}`)}
              >
                <i className="sem" aria-hidden="true" />
                <span>
                  <b>{a.motivo}</b>
                  <br />
                  <span className="mono small">{a.codigo}</span> <span className="small muted">· {a.titulo}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const NOMBRE_TEXTO = { normal: 'normal', grande: 'grande', 'muy-grande': 'muy grande' } as const;

type Item = { ruta: string; texto: string; permiso: string; badge?: 'activos' | 'verificar' };
type Grupo = { titulo: string; items: Item[] };

/** Menú del panel (A01–A14, T01–T04). Un ítem sin permiso no se muestra: para ese rol no existe. */
export const MENU: Grupo[] = [
  {
    titulo: 'General',
    items: [
      { ruta: '/', texto: 'Dashboard', permiso: 'dashboard.ver_general' },
      { ruta: '/incidentes', texto: 'Incidentes', permiso: 'incidente.ver_todos', badge: 'activos' },
      { ruta: '/verificaciones', texto: 'Verificar cierres', permiso: 'incidente.verificar_cierre', badge: 'verificar' },
      { ruta: '/historial', texto: 'Historial', permiso: 'dashboard.ver_general' },
    ],
  },
  {
    titulo: 'Mi trabajo',
    items: [
      { ruta: '/mis-incidentes', texto: 'Mis incidentes', permiso: 'incidente.ver_asignados', badge: 'activos' },
      { ruta: '/historial', texto: 'Historial', permiso: 'dashboard.ver_propio' },
    ],
  },
  {
    titulo: 'Infraestructura',
    items: [
      { ruta: '/ubicaciones', texto: 'Ubicaciones', permiso: 'ubicacion.gestionar' },
      { ruta: '/equipos', texto: 'Equipos', permiso: 'equipo.gestionar' },
    ],
  },
  {
    titulo: 'Personal',
    items: [
      { ruta: '/tecnicos', texto: 'Técnicos', permiso: 'tecnico.gestionar' },
      { ruta: '/usuarios', texto: 'Usuarios y roles', permiso: 'usuario.gestionar' },
    ],
  },
  {
    titulo: 'WhatsApp e IA',
    items: [
      { ruta: '/conversaciones', texto: 'Conversaciones', permiso: 'conversacion.ver' },
      { ruta: '/reglas', texto: 'Reglas de prioridad', permiso: 'regla.gestionar' },
    ],
  },
  {
    titulo: 'Sistema',
    items: [
      { ruta: '/reportes', texto: 'Reportes', permiso: 'reporte.ver' },
      { ruta: '/configuracion', texto: 'Configuración', permiso: 'parametro.gestionar' },
      { ruta: '/auditoria', texto: 'Auditoría', permiso: 'auditoria.ver' },
    ],
  },
  {
    titulo: 'Cuenta',
    items: [{ ruta: '/perfil', texto: 'Mi perfil', permiso: 'disponibilidad.cambiar' }],
  },
];

export function Shell() {
  const { usuario, puede, salir } = useSesion();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [contadores, setContadores] = useState<{ activos?: number; verificar?: number }>({});
  const [busqueda, setBusqueda] = useState('');
  const [menuAbierto, setMenuAbierto] = useState(false);
  const { tema, texto, cambiarTema, cambiarTexto } = usePreferencias();

  // En pantallas angostas el menú es un panel deslizable: se cierra al navegar
  useEffect(() => {
    setMenuAbierto(false);
  }, [pathname]);

  const contar = () =>
    api('/dashboard')
      .then((d) => {
        if (d.tipo === 'general') setContadores({ activos: d.kpi.pendientes + d.kpi.en_atencion + d.kpi.por_verificar, verificar: d.kpi.por_verificar });
        else setContadores({ activos: d.resumen.por_iniciar + d.resumen.en_proceso + d.resumen.en_verificacion });
      })
      .catch(() => undefined);
  useEffect(() => {
    contar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  // Los números del menú (incidentes activos, por verificar) también se actualizan solos
  useIntervalo(() => void contar(), 15000);

  if (!usuario) return null;
  const esTecnico = usuario.rol === 'TECNICO';

  const buscar = (e: FormEvent) => {
    e.preventDefault();
    const q = busqueda.trim();
    navigate(`${esTecnico ? '/mis-incidentes' : '/incidentes'}${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  };

  return (
    <div className={`app ${menuAbierto ? 'menu-abierto' : ''}`}>
      <div className="velo" onClick={() => setMenuAbierto(false)} />
      <aside className="side" aria-label="Menú principal">
        <div className="logo"><b>SG</b>SGIM</div>
        {MENU.map((g) => {
          const items = g.items.filter((i) => puede(i.permiso));
          if (!items.length) return null;
          return (
            <div key={g.titulo}>
              <div className="grp">{g.titulo}</div>
              {items.map((i) => (
                <NavLink key={i.ruta + i.texto} to={i.ruta} end={i.ruta === '/'}>
                  {i.texto}
                  {i.badge && contadores[i.badge] ? <span className="n">{contadores[i.badge]}</span> : null}
                </NavLink>
              ))}
            </div>
          );
        })}
        <div style={{ marginTop: 'auto' }} />
        <button
          className="link"
          onClick={() => {
            salir();
            navigate('/login');
          }}
        >
          ↩ Cerrar sesión
        </button>
      </aside>
      <div className="main">
        <div className="bar">
          <button className="hamburguesa" onClick={() => setMenuAbierto(true)} aria-label="Abrir menú">☰</button>
          <form onSubmit={buscar} style={{ flex: 1, maxWidth: 340 }}>
            <input
              id="buscar"
              className="search"
              style={{ width: '100%' }}
              placeholder={esTecnico ? '🔍 Buscar por código, ubicación o equipo…' : '🔍 Buscar por código, ubicación, equipo o técnico…'}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </form>
          <div className="me">
            <button
              type="button"
              className="icono txt"
              onClick={cambiarTexto}
              aria-label={`Tamaño de letra: ${NOMBRE_TEXTO[texto]}. Cambiar`}
              title={`Tamaño de letra: ${NOMBRE_TEXTO[texto]} (clic para cambiar)`}
            >
              {texto === 'normal' ? 'A+' : texto === 'grande' ? 'A++' : 'A'}
            </button>
            <button
              type="button"
              className="icono"
              onClick={cambiarTema}
              aria-label={tema === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              title={tema === 'oscuro' ? 'Modo claro' : 'Modo oscuro'}
            >
              {tema === 'oscuro' ? '☀️' : '🌙'}
            </button>
            {(puede('incidente.ver_todos') || puede('incidente.ver_asignados')) && <Campana esTecnico={esTecnico} />}
            <NavLink to="/perfil" className="av" title="Mi perfil" style={{ textDecoration: 'none' }}>
              {iniciales(usuario.nombres, usuario.apellidos)}
            </NavLink>
            <span className="nombre">
              <b>{esTecnico ? `${usuario.nombres} ${usuario.apellidos}` : `${usuario.nombres} ${usuario.apellidos[0]}.`}</b>
              <br />
              <span className="muted">{esTecnico ? 'Técnico' : 'Administrador'}</span>
            </span>
          </div>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
