import { useState } from 'react';
import { Cargando, ErrorBox, fechaCorta, useCarga } from '../ui';

/** Resume el cambio registrado en una línea legible. */
function detalle(f: any) {
  if (f.accion === 'ACCESO_DENEGADO') return 'Intento de acceso sin permiso';
  if (f.accion === 'LOGIN') return 'Inicio de sesión correcto';
  if (f.accion === 'LOGIN_FALLIDO') return f.datos_nuevos?.correo ?? 'Intento fallido';
  const n = f.datos_nuevos ?? {};
  const a = f.datos_anteriores ?? {};
  const cambios = Object.keys(n)
    .filter((k) => k in a && JSON.stringify(a[k]) !== JSON.stringify(n[k]))
    .map((k) => `${k}: ${a[k] ?? '—'} → ${n[k] ?? '—'}`);
  return cambios.join(' · ') || '';
}

/** A14 · Auditoría (solo lectura) */
export function Auditoria() {
  const [usuario, setUsuario] = useState('');
  const [accion, setAccion] = useState('');
  const [desde, setDesde] = useState('');
  const [pagina, setPagina] = useState(1);
  const qs = new URLSearchParams({ pagina: String(pagina) });
  if (usuario) qs.set('usuario', usuario);
  if (accion) qs.set('accion', accion);
  if (desde) qs.set('desde', desde);
  const { datos, error } = useCarga(`/auditoria?${qs}`);
  const total = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1;
  const filtrar = (fn: () => void) => { fn(); setPagina(1); };

  return (
    <>
      <h3>Auditoría</h3>
      <div className="filters">
        <select id="au-usuario" className="input" aria-label="Usuario" value={usuario} onChange={(e) => filtrar(() => setUsuario(e.target.value))}>
          <option value="">Usuario: Todos</option>
          {datos?.usuarios.map((u: any) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
        <select id="au-accion" className="input" aria-label="Acción" value={accion} onChange={(e) => filtrar(() => setAccion(e.target.value))}>
          <option value="">Acción: Todas</option>
          {datos?.acciones.map((a: string) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="check">Desde <input id="au-desde" className="input" type="date" value={desde} onChange={(e) => filtrar(() => setDesde(e.target.value))} /></label>
      </div>
      {error && <ErrorBox msg={error} />}
      <div className="card p0 wrap-x">
        {!datos ? (
          <Cargando />
        ) : (
          <table className="t">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th><th>IP</th></tr></thead>
            <tbody>
              {datos.filas.map((f: any) => (
                <tr key={f.id_auditoria}>
                  <td className="mono small">{fechaCorta(f.creado_en)}</td>
                  <td>{f.usuario ?? '—'}</td>
                  <td className="mono small">{f.accion}</td>
                  <td className="small">{f.entidad ? `${f.entidad}${f.id_entidad ? ` ${f.id_entidad}` : ''}` : '—'}</td>
                  <td className="small">{detalle(f)}</td>
                  <td className="mono small">{f.ip ?? '—'}</td>
                </tr>
              ))}
              {datos.filas.length === 0 && <tr><td colSpan={6} className="empty">No hay registros con esos filtros.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {datos && (
        <div className="row between small muted">
          <span>{datos.total} registros · página {pagina} de {total}</span>
          <div className="row">
            <button className="btn" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>← Anterior</button>
            <button className="btn" disabled={pagina >= total} onClick={() => setPagina(pagina + 1)}>Siguiente →</button>
          </div>
        </div>
      )}
      <div className="small muted">La bitácora es de solo lectura: nadie puede editarla ni borrarla.</div>
    </>
  );
}
