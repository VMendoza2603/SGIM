import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, token } from '../api';
import { inicioDe, useSesion, type Usuario } from '../auth';

/** P02 · Recuperar contraseña: pide un enlace de un solo uso (válido 30 minutos). */
export function Recuperar() {
  const [correo, setCorreo] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/auth/recuperar', { method: 'POST', body: { correo } });
      setEnviado(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div className="centro">
      <form className="card" onSubmit={enviar}>
        <h3>Recuperar contraseña</h3>
        <div className="small muted">Te enviaremos un enlace válido por 30 minutos.</div>
        <div className="field">
          <label htmlFor="rc-mail">Correo institucional</label>
          <input id="rc-mail" className="input" type="email" required value={correo} onChange={(e) => setCorreo(e.target.value)} />
        </div>
        <button className="btn pri block">Enviar enlace</button>
        {enviado && <div className="notice n-ok">Si el correo está registrado, recibirás el enlace en unos minutos.</div>}
        {error && <div className="notice n-bad">{error}</div>}
        <Link className="small" to="/login">← Volver al inicio de sesión</Link>
      </form>
    </div>
  );
}

export const REGLAS_CONTRASENA = [
  { ok: (p: string) => p.length >= 8, txt: '8+ caracteres' },
  { ok: (p: string) => /[A-Z]/.test(p), txt: 'Mayúscula' },
  { ok: (p: string) => /[0-9]/.test(p), txt: 'Número' },
  { ok: (p: string) => /[^A-Za-z0-9]/.test(p), txt: 'Símbolo' },
];

/** P03 · Cambio de contraseña obligatorio en el primer ingreso. */
export function PrimerIngreso() {
  const { usuario, actualizar } = useSesion();
  const navigate = useNavigate();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirma, setConfirma] = useState('');
  const [error, setError] = useState('');

  if (!usuario) return <Navigate to="/login" replace />;
  if (!usuario.debeCambiarPwd) return <Navigate to={inicioDe(usuario)} replace />;

  const valida = REGLAS_CONTRASENA.every((r) => r.ok(nueva)) && nueva === confirma && actual.length > 0;

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const r = await api<{ token: string; usuario: Usuario }>('/auth/cambiar-password', { method: 'POST', body: { actual, nueva } });
      token.guardar(r.token);
      actualizar(r.usuario);
      navigate(inicioDe(r.usuario), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="centro">
      <form className="card" onSubmit={guardar}>
        <h3>Crea tu contraseña</h3>
        <div className="notice n-info">Es tu primer ingreso. Por seguridad debes reemplazar la contraseña temporal.</div>
        <div className="field">
          <label htmlFor="pi-actual">Contraseña temporal</label>
          <input id="pi-actual" className="input" type="password" value={actual} onChange={(e) => setActual(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pi-nueva">Nueva contraseña</label>
          <input id="pi-nueva" className="input" type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
        </div>
        <div className="small">
          {REGLAS_CONTRASENA.map((r) => (
            <span key={r.txt} style={{ marginRight: 10, color: r.ok(nueva) ? 'var(--ok)' : 'var(--ink-2)' }}>
              {r.ok(nueva) ? '✓' : '○'} {r.txt}
            </span>
          ))}
        </div>
        <div className="field">
          <label htmlFor="pi-confirma">Confirmar contraseña</label>
          <input id="pi-confirma" className="input" type="password" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
          {confirma && confirma !== nueva && <span style={{ color: 'var(--bad)' }}>Las contraseñas no coinciden</span>}
        </div>
        <button className="btn pri block" disabled={!valida}>Guardar y continuar</button>
        {error && <div className="notice n-bad">{error}</div>}
      </form>
    </div>
  );
}

/** P02 (paso 2) · Nueva contraseña desde el enlace recibido por correo. */
export function Restablecer() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [nueva, setNueva] = useState('');
  const [confirma, setConfirma] = useState('');
  const [error, setError] = useState('');
  const [listo, setListo] = useState(false);
  const valida = REGLAS_CONTRASENA.every((r) => r.ok(nueva)) && nueva === confirma;

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/auth/restablecer', { method: 'POST', body: { token: params.get('token') ?? '', nueva } });
      setListo(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="centro">
      <form className="card" onSubmit={guardar}>
        <h3>Define tu nueva contraseña</h3>
        <div className="field">
          <label htmlFor="rs-nueva">Nueva contraseña</label>
          <input id="rs-nueva" className="input" type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
        </div>
        <div className="small">
          {REGLAS_CONTRASENA.map((r) => (
            <span key={r.txt} style={{ marginRight: 10, color: r.ok(nueva) ? 'var(--ok)' : 'var(--ink-2)' }}>{r.ok(nueva) ? '✓' : '○'} {r.txt}</span>
          ))}
        </div>
        <div className="field">
          <label htmlFor="rs-confirma">Confirmar contraseña</label>
          <input id="rs-confirma" className="input" type="password" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
        </div>
        <button className="btn pri block" disabled={!valida || listo}>Guardar contraseña</button>
        {listo && <div className="notice n-ok">Contraseña actualizada. Te llevamos al inicio de sesión…</div>}
        {error && <div className="notice n-bad">{error}</div>}
        <Link className="small" to="/recuperar">Solicitar un enlace nuevo</Link>
      </form>
    </div>
  );
}

/** P04 · Acceso denegado */
export function SinAcceso() {
  const { usuario } = useSesion();
  return (
    <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
      <div style={{ textAlign: 'center', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <div className="mono" style={{ fontSize: 44, fontWeight: 700, color: 'var(--accent)' }}>403</div>
        <h3>No tienes acceso a esta sección</h3>
        <div className="small muted">
          Esta sección solo está disponible para el coordinador de mantenimiento. Si necesitas cambiar algo, pídeselo al coordinador.
        </div>
        {usuario && (
          <Link className="btn pri" to={inicioDe(usuario)}>
            {usuario.rol === 'TECNICO' ? 'Ir a Mis incidentes' : 'Ir al Dashboard'}
          </Link>
        )}
      </div>
    </div>
  );
}
