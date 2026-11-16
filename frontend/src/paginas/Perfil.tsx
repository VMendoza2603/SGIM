import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, token } from '../api';
import { useSesion, type Usuario } from '../auth';
import { Campo, Cargando, ErrorBox, Telefono, useAccion, useCarga } from '../ui';
import { REGLAS_CONTRASENA } from './Acceso';

/** T04 · Mi perfil (también para el coordinador). */
export function Perfil() {
  const { actualizar, salir } = useSesion();
  const navigate = useNavigate();
  const { datos, error, recargar } = useCarga('/perfil');
  const datosAcc = useAccion();
  const claveAcc = useAccion();
  const [telefono, setTelefono] = useState('');
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');

  useEffect(() => {
    setTelefono(datos?.telefono_wa ?? '');
  }, [datos]);
  if (error) return <ErrorBox msg={error} />;
  if (!datos) return <Cargando />;
  const tecnico = datos.disponible != null; // solo los técnicos tienen ficha en `tecnico`

  const guardarDatos = (e: FormEvent) => {
    e.preventDefault();
    datosAcc.ejecutar(() => api('/perfil', { method: 'PUT', body: { telefono_wa: telefono } }), 'Teléfono actualizado.').then(recargar);
  };
  const cambiarClave = async (e: FormEvent) => {
    e.preventDefault();
    await claveAcc.ejecutar(async () => {
      const r = await api<{ token: string; usuario: Usuario }>('/auth/cambiar-password', { method: 'POST', body: { actual, nueva } });
      token.guardar(r.token);
      actualizar(r.usuario);
      setActual('');
      setNueva('');
    }, 'Contraseña actualizada. Las demás sesiones se cerraron.');
  };
  const cerrarTodas = () =>
    claveAcc.ejecutar(async () => {
      await api('/auth/cerrar-sesiones', { method: 'POST' });
      salir();
      navigate('/login');
    });

  return (
    <>
      <h3>Mi perfil</h3>
      <div className="grid g2">
        <form className="card stack" onSubmit={guardarDatos}>
          <Campo id="pf-nombre" etiqueta="Nombres"><input id="pf-nombre" className="input ro" readOnly value={`${datos.nombres} ${datos.apellidos}`} /></Campo>
          <Campo id="pf-correo" etiqueta="Correo"><input id="pf-correo" className="input ro" readOnly value={datos.correo ?? ''} /></Campo>
          <Campo id="pf-tel" etiqueta="WhatsApp para notificaciones" ayuda="Celular de 9 dígitos, con o sin el 0 inicial">
            <Telefono id="pf-tel" required value={telefono} onChange={setTelefono} />
          </Campo>
          <datosAcc.Aviso />
          <div className="row end"><button className="btn dark" disabled={datosAcc.ocupado || telefono === datos.telefono_wa}>Guardar</button></div>
        </form>
        <form className="card stack" onSubmit={cambiarClave}>
          <h4>Cambiar contraseña</h4>
          <Campo id="pf-actual" etiqueta="Contraseña actual"><input id="pf-actual" className="input" type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} /></Campo>
          <Campo id="pf-nueva" etiqueta="Nueva contraseña"><input id="pf-nueva" className="input" type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} /></Campo>
          <div className="small">
            {REGLAS_CONTRASENA.map((r) => (
              <span key={r.txt} style={{ marginRight: 10, color: r.ok(nueva) ? 'var(--ok)' : 'var(--ink-2)' }}>{r.ok(nueva) ? '✓' : '○'} {r.txt}</span>
            ))}
          </div>
          <claveAcc.Aviso />
          <button className="btn pri" disabled={claveAcc.ocupado || !actual || !REGLAS_CONTRASENA.every((r) => r.ok(nueva))}>Actualizar</button>
          <button type="button" className="btn" onClick={cerrarTodas}>Cerrar sesión en todos los dispositivos</button>
        </form>
      </div>
      {tecnico && (
        <div className="card stack-sm">
          <h4>Especialidades y zonas</h4>
          <div className="small">
            {datos.especialidades.map((e: any) => `${e.nombre}${e.principal ? ' (principal)' : ''}`).join(', ')} · Bloques {datos.zonas.join(', ') || 'todos'}{' '}
            <span className="lock">🔒 las asigna el coordinador</span>
          </div>
          <div className="small">
            {datos.disponible ? 'Disponible para nuevas asignaciones' : 'No disponible (no recibes asignaciones automáticas)'}{' '}
            <span className="lock">🔒 la cambia el coordinador</span>
          </div>
        </div>
      )}
    </>
  );
}
