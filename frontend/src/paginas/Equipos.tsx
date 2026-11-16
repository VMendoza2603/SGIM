import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useSesion } from '../auth';
import { Campo, Cargando, Dialogo, ErrorBox, Estado, ESTADO_EQUIPO, soloFecha, useAccion, useCarga, useDiferido } from '../ui';

const PillEquipo = ({ e }: { e: string }) => <span className={`pill ${ESTADO_EQUIPO[e]?.clase}`}>{ESTADO_EQUIPO[e]?.texto ?? e}</span>;
const hoy = () => new Date().toISOString().slice(0, 10);

/** Formulario de alta / edición de equipo (A07). */
function FormEquipo({ inicial, onCerrar, onGuardado }: { inicial: any; onCerrar: () => void; onGuardado: (codigo: string) => void }) {
  const { datos: cat } = useCarga('/catalogos');
  const { datos: lista } = useCarga('/infraestructura/equipos');
  const { ejecutar, Aviso, ocupado } = useAccion();
  const [d, setD] = useState<any>(inicial);
  const set = (k: string, v: unknown) => setD({ ...d, [k]: v });

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      id_tipo_equipo: Number(d.id_tipo_equipo), id_ubicacion: Number(d.id_ubicacion), codigo_inventario: d.codigo_inventario,
      marca: d.marca || null, modelo: d.modelo || null, numero_serie: d.numero_serie || null,
      fecha_instalacion: d.fecha_instalacion?.slice(0, 10) || null, ultimo_mantenimiento: d.ultimo_mantenimiento?.slice(0, 10) || null,
      estado: d.estado ?? 'OPERATIVO', observaciones: d.observaciones || null,
    };
    await ejecutar(async () => {
      if (d.id_equipo) await api(`/infraestructura/equipos/${d.id_equipo}`, { method: 'PUT', body });
      else await api('/infraestructura/equipos', { method: 'POST', body });
      onGuardado(body.codigo_inventario.toUpperCase());
    });
  };

  return (
    <Dialogo titulo={d.id_equipo ? `Editar ${d.codigo_inventario}` : 'Nuevo equipo'} onCerrar={onCerrar}>
      {!cat || !lista ? (
        <Cargando />
      ) : (
        <form className="stack" onSubmit={guardar}>
          <div className="form-grid">
            <Campo id="eq-cod" etiqueta="Código de inventario"><input id="eq-cod" className="input" required value={d.codigo_inventario ?? ''} onChange={(e) => set('codigo_inventario', e.target.value)} /></Campo>
            <Campo id="eq-tipo" etiqueta="Tipo">
              <select id="eq-tipo" className="input" required value={d.id_tipo_equipo ?? ''} onChange={(e) => set('id_tipo_equipo', e.target.value)}>
                <option value="">Elige…</option>
                {lista.tipos.map((t: any) => <option key={t.id} value={t.id}>{t.nombre} ({t.categoria})</option>)}
              </select>
            </Campo>
            <Campo id="eq-ubic" etiqueta="Ubicación" className="full">
              <select id="eq-ubic" className="input" required value={d.id_ubicacion ?? ''} onChange={(e) => set('id_ubicacion', e.target.value)}>
                <option value="">Elige…</option>
                {cat.ubicaciones.map((u: any) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
              </select>
            </Campo>
            <Campo id="eq-marca" etiqueta="Marca"><input id="eq-marca" className="input" value={d.marca ?? ''} onChange={(e) => set('marca', e.target.value)} /></Campo>
            <Campo id="eq-modelo" etiqueta="Modelo"><input id="eq-modelo" className="input" value={d.modelo ?? ''} onChange={(e) => set('modelo', e.target.value)} /></Campo>
            <Campo id="eq-serie" etiqueta="Número de serie"><input id="eq-serie" className="input" value={d.numero_serie ?? ''} onChange={(e) => set('numero_serie', e.target.value)} /></Campo>
            <Campo id="eq-estado" etiqueta="Estado">
              <select id="eq-estado" className="input" value={d.estado ?? 'OPERATIVO'} onChange={(e) => set('estado', e.target.value)}>
                <option value="OPERATIVO">Operativo</option>
                <option value="CON_FALLA">Con falla</option>
                <option value="FUERA_DE_SERVICIO">Fuera de servicio</option>
              </select>
            </Campo>
            <Campo id="eq-inst" etiqueta="Instalación"><input id="eq-inst" className="input" type="date" max={hoy()} value={d.fecha_instalacion?.slice(0, 10) ?? ''} onChange={(e) => set('fecha_instalacion', e.target.value)} /></Campo>
            <Campo id="eq-mant" etiqueta="Último mantenimiento"><input id="eq-mant" className="input" type="date" max={hoy()} value={d.ultimo_mantenimiento?.slice(0, 10) ?? ''} onChange={(e) => set('ultimo_mantenimiento', e.target.value)} /></Campo>
            <Campo id="eq-obs" etiqueta="Observaciones" className="full"><textarea id="eq-obs" className="input" value={d.observaciones ?? ''} onChange={(e) => set('observaciones', e.target.value)} /></Campo>
          </div>
          <Aviso />
          <div className="row end">
            <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
            <button className="btn pri" disabled={ocupado}>Guardar</button>
          </div>
        </form>
      )}
    </Dialogo>
  );
}

/** A07 · Listado de equipos */
export function Equipos() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const qDiferida = useDiferido(q);
  const { datos, error, recargar } = useCarga(`/infraestructura/equipos?${new URLSearchParams({ q: qDiferida, estado })}`);
  const [nuevo, setNuevo] = useState(false);

  return (
    <>
      <div className="row between">
        <h3>Equipos</h3>
        <button className="btn pri" onClick={() => setNuevo(true)}>+ Nuevo equipo</button>
      </div>
      <div className="filters">
        <input id="eq-buscar" className="input" placeholder="Buscar por código, tipo o marca" value={q} onChange={(e) => setQ(e.target.value)} />
        <select id="eq-filtro-estado" className="input" aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Estado: Todos</option>
          {Object.entries(ESTADO_EQUIPO).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
        </select>
      </div>
      {error && <ErrorBox msg={error} />}
      <div className="card p0 wrap-x">
        {!datos ? (
          <Cargando />
        ) : (
          <table className="t">
            <thead><tr><th>Código</th><th>Tipo</th><th>Ubicación</th><th>Marca / modelo</th><th>Incidentes</th><th>Últ. mantenimiento</th><th>Estado</th></tr></thead>
            <tbody>
              {datos.equipos.map((e: any) => (
                <tr key={e.id_equipo} className="click" onClick={() => navigate(`/equipos/${e.codigo_inventario}`)} style={{ opacity: e.activo ? 1 : 0.55 }}>
                  <td className="mono">{e.codigo_inventario}</td>
                  <td>{e.tipo}<div className="small muted">{e.categoria}</div></td>
                  <td>{e.ubicacion_codigo} · {e.ubicacion}</td>
                  <td>{[e.marca, e.modelo].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{e.incidentes}</td>
                  <td className="mono small">{soloFecha(e.ultimo_mantenimiento)}</td>
                  <td><PillEquipo e={e.estado} /></td>
                </tr>
              ))}
              {datos.equipos.length === 0 && <tr><td colSpan={7} className="empty">No hay equipos con esos filtros.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {nuevo && <FormEquipo inicial={{ estado: 'OPERATIVO' }} onCerrar={() => setNuevo(false)} onGuardado={(c) => { setNuevo(false); recargar(); navigate(`/equipos/${c}`); }} />}
    </>
  );
}

/** A07 · Ficha de equipo (el técnico la ve en solo lectura) */
export function FichaEquipo() {
  const { codigo } = useParams();
  const navigate = useNavigate();
  const { puede } = useSesion();
  const { datos: e, error, recargar } = useCarga(`/infraestructura/equipos/${codigo}`);
  const { ejecutar, Aviso } = useAccion();
  const [editar, setEditar] = useState(false);
  const [baja, setBaja] = useState(false);
  const [motivo, setMotivo] = useState('');
  const gestiona = puede('equipo.gestionar');

  if (error) return <ErrorBox msg={error} />;
  if (!e) return <Cargando />;

  return (
    <>
      <div className="crumb">{gestiona ? <Link to="/equipos">Equipos</Link> : 'Equipos'} / {e.codigo_inventario}</div>
      <div className="row between">
        <h3>{e.tipo} · {e.codigo_inventario}</h3>
        {gestiona && e.activo && (
          <div className="row">
            <button className="btn" onClick={() => setEditar(true)}>Editar</button>
            <button className="btn danger" onClick={() => setBaja(true)}>Dar de baja</button>
          </div>
        )}
      </div>
      <Aviso />
      <div className="grid g-main">
        <div className="card">
          <dl className="kv">
            <dt>Ubicación</dt><dd>{e.ubicacion_codigo} · {e.ubicacion}</dd>
            <dt>Categoría</dt><dd>{e.categoria}</dd>
            <dt>Marca / modelo</dt><dd>{[e.marca, e.modelo].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Número de serie</dt><dd>{e.numero_serie ?? '—'}</dd>
            <dt>Instalación</dt><dd className="mono">{soloFecha(e.fecha_instalacion)}</dd>
            <dt>Último mantenimiento</dt><dd className="mono">{soloFecha(e.ultimo_mantenimiento)}</dd>
            {e.frecuencia_preventivo_dias && (<><dt>Preventivo</dt><dd>Cada {e.frecuencia_preventivo_dias} días</dd></>)}
            <dt>Estado</dt><dd><PillEquipo e={e.estado} /></dd>
            {e.observaciones && (<><dt>Observaciones</dt><dd>{e.observaciones}</dd></>)}
          </dl>
        </div>
        <div className="card">
          <h4>Incidentes del equipo</h4>
          {e.incidentes.length === 0 ? (
            <div className="small muted">Sin incidentes registrados.</div>
          ) : (
            <div className="timeline">
              {e.incidentes.map((i: any) => (
                <div className="ev" key={i.codigo}>
                  <i />
                  <div>
                    <b>{gestiona ? <Link to={`/incidentes/${i.codigo}`}>{i.codigo}</Link> : i.codigo}</b> · {i.titulo}
                    <div className="muted row" style={{ gap: 6 }}>
                      {soloFecha(i.fecha_reporte)} · <Estado s={i.estado} />{i.horas_resolucion != null && ` · resuelto en ${i.horas_resolucion} h`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {editar && <FormEquipo inicial={e} onCerrar={() => setEditar(false)} onGuardado={(c) => { setEditar(false); c !== codigo ? navigate(`/equipos/${c}`) : recargar(); }} />}
      {baja && (
        <Dialogo titulo={`Dar de baja ${e.codigo_inventario}`} onCerrar={() => setBaja(false)}>
          <div className="small muted">El equipo conserva su historial; ya no se podrá asignar a nuevos incidentes.</div>
          <Campo id="baja-motivo" etiqueta="Motivo"><textarea id="baja-motivo" className="input" value={motivo} onChange={(ev) => setMotivo(ev.target.value)} autoFocus /></Campo>
          <div className="row end">
            <button className="btn" onClick={() => setBaja(false)}>Volver</button>
            <button
              className="btn danger"
              disabled={motivo.trim().length < 3}
              onClick={async () => {
                setBaja(false);
                await ejecutar(() => api(`/infraestructura/equipos/${e.id_equipo}/baja`, { method: 'POST', body: { motivo } }), 'Equipo dado de baja.');
                recargar();
              }}
            >
              Dar de baja
            </button>
          </div>
        </Dialogo>
      )}
    </>
  );
}
