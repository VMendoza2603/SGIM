import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useSesion } from '../auth';
import { Campo, Cargando, ContrasenaTemporal, Dialogo, ErrorBox, fechaCorta, Interruptor, Telefono, TIPO_MIEMBRO, useAccion, useCarga, useDiferido } from '../ui';

const PUNTO: Record<string, string> = { ADMIN: 'admin', TECNICO: 'tec', COMUNIDAD: 'com' };
const ROL: Record<string, string> = { ADMIN: 'Administrador', TECNICO: 'Técnico', COMUNIDAD: 'Comunidad' };

function FormUsuario({ inicial, onCerrar, onGuardado }: { inicial: any; onCerrar: () => void; onGuardado: (temporal?: string, nombre?: string) => void }) {
  const { ejecutar, Aviso, ocupado } = useAccion();
  const [d, setD] = useState<any>(inicial);
  const set = (k: string, v: unknown) => setD({ ...d, [k]: v });
  const comunidad = d.rol === 'COMUNIDAD';

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      nombres: d.nombres, apellidos: d.apellidos, cedula: d.cedula || null, correo: d.correo || null,
      telefono_wa: d.telefono_wa || null, tipo_miembro: comunidad ? d.tipo_miembro : null,
    };
    await ejecutar(async () => {
      if (d.id_usuario) {
        await api(`/personal/usuarios/${d.id_usuario}`, { method: 'PUT', body });
        onGuardado();
      } else {
        const r = await api('/personal/usuarios', { method: 'POST', body: { ...body, rol: d.rol } });
        onGuardado(r.contrasenaTemporal ?? undefined, `${d.nombres} ${d.apellidos}`);
      }
    });
  };

  return (
    <Dialogo titulo={d.id_usuario ? `Editar a ${d.nombres}` : 'Nuevo usuario'} onCerrar={onCerrar}>
      <form className="stack" onSubmit={guardar}>
        {!d.id_usuario && (
          <Campo id="us-rol" etiqueta="Rol" ayuda="Los técnicos se crean desde la pantalla Técnicos (necesitan especialidades).">
            <select id="us-rol" className="input" value={d.rol} onChange={(e) => set('rol', e.target.value)}>
              <option value="COMUNIDAD">Comunidad educativa (solo WhatsApp)</option>
              <option value="ADMIN">Administrador / Coordinador</option>
            </select>
          </Campo>
        )}
        <div className="form-grid">
          <Campo id="us-nom" etiqueta="Nombres"><input id="us-nom" className="input" required value={d.nombres ?? ''} onChange={(e) => set('nombres', e.target.value)} /></Campo>
          <Campo id="us-ape" etiqueta="Apellidos"><input id="us-ape" className="input" required value={d.apellidos ?? ''} onChange={(e) => set('apellidos', e.target.value)} /></Campo>
          {comunidad ? (
            <>
              <Campo id="us-tel" etiqueta="WhatsApp" ayuda="Celular de 9 dígitos, con o sin el 0 inicial"><Telefono id="us-tel" required value={d.telefono_wa} onChange={(v) => set('telefono_wa', v)} /></Campo>
              <Campo id="us-tipo" etiqueta="Tipo">
                <select id="us-tipo" className="input" value={d.tipo_miembro ?? 'ESTUDIANTE'} onChange={(e) => set('tipo_miembro', e.target.value)}>
                  {Object.entries(TIPO_MIEMBRO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Campo>
            </>
          ) : (
            <>
              <Campo id="us-mail" etiqueta="Correo"><input id="us-mail" className="input" type="email" required value={d.correo ?? ''} onChange={(e) => set('correo', e.target.value)} /></Campo>
              <Campo id="us-tel2" etiqueta="WhatsApp (opcional)"><Telefono id="us-tel2" value={d.telefono_wa} onChange={(v) => set('telefono_wa', v)} /></Campo>
            </>
          )}
          <Campo id="us-ced" etiqueta="Cédula"><input id="us-ced" className="input" maxLength={13} value={d.cedula ?? ''} onChange={(e) => set('cedula', e.target.value)} /></Campo>
        </div>
        <Aviso />
        <div className="row end">
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn pri" disabled={ocupado}>Guardar</button>
        </div>
      </form>
    </Dialogo>
  );
}

/** Pestaña de permisos por rol (matriz editable). */
function Permisos() {
  const { datos, error, recargar } = useCarga('/personal/roles');
  const { ejecutar, Aviso, ocupado } = useAccion();
  const [sel, setSel] = useState<Record<number, Set<number>>>({});

  useEffect(() => {
    if (!datos) return;
    const m: Record<number, Set<number>> = {};
    datos.roles.forEach((r: any) => (m[r.id_rol] = new Set(datos.asignados.filter((a: any) => a.id_rol === r.id_rol).map((a: any) => a.id_permiso))));
    setSel(m);
  }, [datos]);

  const modulos = useMemo(() => {
    const g: Record<string, any[]> = {};
    (datos?.permisos ?? []).forEach((p: any) => (g[p.modulo] ??= []).push(p));
    return g;
  }, [datos]);

  if (error) return <ErrorBox msg={error} />;
  if (!datos) return <Cargando />;

  const alternar = (rol: number, p: number) => {
    const s = new Set(sel[rol]);
    s.has(p) ? s.delete(p) : s.add(p);
    setSel({ ...sel, [rol]: s });
  };
  const guardar = () =>
    ejecutar(async () => {
      for (const r of datos.roles) await api(`/personal/roles/${r.id_rol}/permisos`, { method: 'PUT', body: { permisos: [...sel[r.id_rol]] } });
    }, 'Permisos actualizados. Los usuarios los verán en su próxima acción.').then(recargar);

  return (
    <div className="stack">
      <div className="card p0 wrap-x">
        <table className="t matriz">
          <thead>
            <tr><th>Permiso</th>{datos.roles.map((r: any) => <th className="c" key={r.id_rol}>{ROL[r.codigo]}</th>)}</tr>
          </thead>
          <tbody>
            {Object.entries(modulos).map(([mod, permisos]) => (
              <FilaModulo key={mod} mod={mod} permisos={permisos} roles={datos.roles} sel={sel} alternar={alternar} />
            ))}
          </tbody>
        </table>
      </div>
      <Aviso />
      <div className="row end"><button className="btn pri" disabled={ocupado} onClick={guardar}>Guardar permisos</button></div>
    </div>
  );
}

function FilaModulo({ mod, permisos, roles, sel, alternar }: { mod: string; permisos: any[]; roles: any[]; sel: Record<number, Set<number>>; alternar: (r: number, p: number) => void }) {
  return (
    <>
      <tr className="mod"><td colSpan={roles.length + 1}>{mod}</td></tr>
      {permisos.map((p) => (
        <tr key={p.id_permiso}>
          <td>{p.descripcion}<div className="small muted mono">{p.codigo}</div></td>
          {roles.map((r) => (
            <td className="c" key={r.id_rol}>
              <input
                id={`perm-${r.id_rol}-${p.id_permiso}`}
                type="checkbox"
                aria-label={`${p.codigo} para ${r.codigo}`}
                checked={!!sel[r.id_rol]?.has(p.id_permiso)}
                onChange={() => alternar(r.id_rol, p.id_permiso)}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** A09 · Usuarios y roles */
export function Usuarios() {
  const { usuario: yo } = useSesion();
  const [pestana, setPestana] = useState<'usuarios' | 'permisos'>('usuarios');
  const [rol, setRol] = useState('');
  const [tipo, setTipo] = useState('');
  const [estado, setEstado] = useState('activos');
  const [q, setQ] = useState('');
  const qDiferida = useDiferido(q);
  const { datos, error, recargar } = useCarga<any[]>(`/personal/usuarios?${new URLSearchParams({ rol, tipo, estado, q: qDiferida })}`);
  const { ejecutar, Aviso } = useAccion();
  const [form, setForm] = useState<any>(null);
  const [temporal, setTemporal] = useState<{ valor: string; para: string } | null>(null);

  const restablecer = (u: any) =>
    ejecutar(async () => {
      const r = await api(`/personal/usuarios/${u.id_usuario}/restablecer`, { method: 'POST' });
      setTemporal({ valor: r.contrasenaTemporal, para: `${u.nombres} ${u.apellidos}` });
    });

  return (
    <>
      <div className="row between">
        <h3>Usuarios y roles</h3>
        {pestana === 'usuarios' && <button className="btn pri" onClick={() => setForm({ rol: 'COMUNIDAD', tipo_miembro: 'ESTUDIANTE' })}>+ Nuevo usuario</button>}
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={pestana === 'usuarios'} onClick={() => setPestana('usuarios')}>Usuarios</button>
        <button role="tab" aria-selected={pestana === 'permisos'} onClick={() => setPestana('permisos')}>Permisos por rol</button>
      </div>
      {pestana === 'permisos' ? (
        <Permisos />
      ) : (
        <>
          <div className="filters">
            <input id="us-buscar" className="input" placeholder="Buscar por nombre, correo o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
            <select id="us-f-rol" className="input" aria-label="Rol" value={rol} onChange={(e) => setRol(e.target.value)}>
              <option value="">Rol: Todos</option>
              {Object.entries(ROL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select id="us-f-tipo" className="input" aria-label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Tipo: Todos</option>
              {Object.entries(TIPO_MIEMBRO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select id="us-f-estado" className="input" aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
              <option value="todos">Todos</option>
            </select>
          </div>
          <Aviso />
          {error && <ErrorBox msg={error} />}
          <div className="card p0 wrap-x">
            {!datos ? (
              <Cargando />
            ) : (
              <table className="t">
                <thead><tr><th>Nombre</th><th>Rol</th><th>Acceso</th><th>Contacto</th><th>Último acceso</th><th>Activo</th><th /></tr></thead>
                <tbody>
                  {datos.map((u) => (
                    <tr key={u.id_usuario} style={{ opacity: u.activo ? 1 : 0.55 }}>
                      <td>{u.nombres} {u.apellidos}{u.bloqueado && <span className="pill n-bad" style={{ marginLeft: 6 }}>Bloqueado</span>}</td>
                      <td><span className="chip"><span className={`dot ${PUNTO[u.rol]}`} />{ROL[u.rol]}{u.tipo_miembro ? ` · ${TIPO_MIEMBRO[u.tipo_miembro]}` : ''}</span></td>
                      <td>{u.rol === 'TECNICO' ? 'Web + WhatsApp' : u.acceso_web ? 'Web' : 'WhatsApp'}</td>
                      <td className="small">{u.acceso_web ? u.correo : <span className="mono">{u.telefono_wa}</span>}</td>
                      <td className="mono small">{fechaCorta(u.ultimo_acceso)}</td>
                      <td>
                        <Interruptor
                          activo={u.activo}
                          deshabilitado={u.id_usuario === yo?.id}
                          etiqueta={u.activo ? 'Desactivar usuario' : 'Activar usuario'}
                          onCambio={(v) => ejecutar(() => api(`/personal/usuarios/${u.id_usuario}/activo`, { method: 'PATCH', body: { activo: v } })).then(recargar)}
                        />
                      </td>
                      <td>
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          {u.rol !== 'TECNICO' && <button className="btn ghost" onClick={() => setForm(u)}>Editar</button>}
                          {u.acceso_web && u.id_usuario !== yo?.id && <button className="btn ghost" onClick={() => restablecer(u)}>Restablecer contraseña</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {datos.length === 0 && <tr><td colSpan={7} className="empty">No hay usuarios con esos filtros.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      {form && (
        <FormUsuario
          inicial={form}
          onCerrar={() => setForm(null)}
          onGuardado={(t, nombre) => {
            if (t) setTemporal({ valor: t, para: nombre ?? '' });
            setForm(null);
            recargar();
          }}
        />
      )}
      {temporal && <ContrasenaTemporal valor={temporal.valor} para={temporal.para} onCerrar={() => setTemporal(null)} />}
    </>
  );
}
