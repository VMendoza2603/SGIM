import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Campo, Cargando, Telefono, TIPO_MIEMBRO, useAccion, useCarga } from '../ui';

const RIESGOS = [
  { k: 'riesgo_personas', t: 'Riesgo para la integridad de personas' },
  { k: 'riesgo_electrico', t: 'Riesgo eléctrico visible' },
  { k: 'fuga_activa', t: 'Fuga de agua activa' },
  { k: 'afecta_clases', t: 'Impide el desarrollo de clases' },
] as const;

/** Registro manual de un incidente (A02 · canal WEB, p. ej. una llamada telefónica). */
export function NuevoIncidente() {
  const navigate = useNavigate();
  const { datos: cat } = useCarga('/catalogos');
  const { ejecutar, Aviso, ocupado } = useAccion();
  const [busqueda, setBusqueda] = useState('');
  const [encontrados, setEncontrados] = useState<any[]>([]);
  const [reportante, setReportante] = useState<any>(null);
  const [nuevoRep, setNuevoRep] = useState(false);
  const [rep, setRep] = useState({ nombres: '', apellidos: '', telefono_wa: '', tipo_miembro: 'DOCENTE' });
  const [d, setD] = useState<any>({ riesgo_personas: false, riesgo_electrico: false, fuga_activa: false, afecta_clases: false });
  const set = (k: string, v: unknown) => setD({ ...d, [k]: v });

  // Búsqueda con espera para no consultar en cada tecla
  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setEncontrados([]);
      return;
    }
    const t = setTimeout(() => api(`/catalogos/reportantes?q=${encodeURIComponent(busqueda)}`).then(setEncontrados).catch(() => undefined), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  if (!cat) return <Cargando />;
  const equipos = cat.equipos.filter((e: any) => String(e.id_ubicacion) === String(d.id_ubicacion));

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    await ejecutar(async () => {
      const r = await api('/incidentes', {
        method: 'POST',
        body: {
          reportante: nuevoRep ? rep : { id_usuario: reportante.id_usuario },
          titulo: d.titulo, descripcion: d.descripcion, id_ubicacion: Number(d.id_ubicacion), id_equipo: d.id_equipo ? Number(d.id_equipo) : null,
          id_categoria: Number(d.id_categoria), personas_afectadas: d.personas_afectadas ? Number(d.personas_afectadas) : null,
          ...Object.fromEntries(RIESGOS.map((x) => [x.k, d[x.k]])),
        },
      });
      navigate(`/incidentes/${r.codigo}`);
    });
  };

  return (
    <>
      <div className="crumb"><Link to="/incidentes">Incidentes</Link> / Registrar incidente</div>
      <h3>Registrar incidente</h3>
      <form className="grid g-main" onSubmit={guardar}>
        <div className="card stack">
          <h4>¿Quién reporta?</h4>
          {!nuevoRep ? (
            <>
              {reportante ? (
                <div className="row between">
                  <span><b>{reportante.nombre}</b> · {TIPO_MIEMBRO[reportante.tipo_miembro]} · <span className="mono">{reportante.telefono_wa}</span></span>
                  <button type="button" className="btn ghost" onClick={() => setReportante(null)}>Cambiar</button>
                </div>
              ) : (
                <Campo id="ni-buscar" etiqueta="Buscar en la comunidad (nombre o teléfono)">
                  <input id="ni-buscar" className="input" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Ej.: Torres o 0999…" />
                  {encontrados.length > 0 && (
                    <div className="lista-conv">
                      {encontrados.map((r) => (
                        <button type="button" key={r.id_usuario} onClick={() => setReportante(r)}>
                          <b>{r.nombre}</b><span className="muted">{TIPO_MIEMBRO[r.tipo_miembro]} · {r.telefono_wa}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </Campo>
              )}
              <button type="button" className="btn ghost" onClick={() => setNuevoRep(true)}>+ Registrar persona nueva</button>
            </>
          ) : (
            <div className="form-grid">
              <Campo id="ni-nom" etiqueta="Nombres"><input id="ni-nom" className="input" required value={rep.nombres} onChange={(e) => setRep({ ...rep, nombres: e.target.value })} /></Campo>
              <Campo id="ni-ape" etiqueta="Apellidos"><input id="ni-ape" className="input" required value={rep.apellidos} onChange={(e) => setRep({ ...rep, apellidos: e.target.value })} /></Campo>
              <Campo id="ni-tel" etiqueta="WhatsApp" ayuda="Celular de 9 dígitos, con o sin el 0 inicial"><Telefono id="ni-tel" required value={rep.telefono_wa} onChange={(v) => setRep({ ...rep, telefono_wa: v })} /></Campo>
              <Campo id="ni-tipo" etiqueta="Tipo">
                <select id="ni-tipo" className="input" value={rep.tipo_miembro} onChange={(e) => setRep({ ...rep, tipo_miembro: e.target.value })}>
                  {Object.entries(TIPO_MIEMBRO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Campo>
              <button type="button" className="btn ghost full" onClick={() => setNuevoRep(false)}>Buscar una persona registrada</button>
            </div>
          )}

          <h4>Incidente</h4>
          <Campo id="ni-titulo" etiqueta="Título"><input id="ni-titulo" className="input" required minLength={4} maxLength={150} value={d.titulo ?? ''} onChange={(e) => set('titulo', e.target.value)} /></Campo>
          <Campo id="ni-desc" etiqueta="Descripción"><textarea id="ni-desc" className="input" required minLength={5} value={d.descripcion ?? ''} onChange={(e) => set('descripcion', e.target.value)} /></Campo>
          <div className="form-grid">
            <Campo id="ni-ubic" etiqueta="Ubicación">
              <select id="ni-ubic" className="input" required value={d.id_ubicacion ?? ''} onChange={(e) => setD({ ...d, id_ubicacion: e.target.value, id_equipo: '' })}>
                <option value="">Elige…</option>
                {cat.ubicaciones.map((u: any) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
              </select>
            </Campo>
            <Campo id="ni-eq" etiqueta="Equipo (opcional)">
              <select id="ni-eq" className="input" value={d.id_equipo ?? ''} onChange={(e) => set('id_equipo', e.target.value)} disabled={!equipos.length}>
                <option value="">Sin equipo</option>
                {equipos.map((q: any) => <option key={q.id} value={q.id}>{q.codigo} · {q.tipo}</option>)}
              </select>
            </Campo>
            <Campo id="ni-cat" etiqueta="Categoría">
              <select id="ni-cat" className="input" required value={d.id_categoria ?? ''} onChange={(e) => set('id_categoria', e.target.value)}>
                <option value="">Elige…</option>
                {cat.categorias.map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
            <Campo id="ni-pers" etiqueta="Personas afectadas"><input id="ni-pers" className="input" type="number" min={0} value={d.personas_afectadas ?? ''} onChange={(e) => set('personas_afectadas', e.target.value)} /></Campo>
          </div>
        </div>
        <div className="grid">
          <div className="card stack-sm">
            <h4>Riesgo e impacto</h4>
            {RIESGOS.map((r) => (
              <label key={r.k} className="check"><input id={`ni-${r.k}`} type="checkbox" checked={d[r.k]} onChange={(e) => set(r.k, e.target.checked)} /> {r.t}</label>
            ))}
            <div className="small muted">La prioridad la calcula el motor de reglas y, si está activa la asignación automática, se asigna al técnico con menor carga.</div>
          </div>
          <Aviso />
          <button className="btn pri block" disabled={ocupado || (!nuevoRep && !reportante)}>Registrar incidente</button>
        </div>
      </form>
    </>
  );
}
