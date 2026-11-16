import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Campo, Cargando, ContrasenaTemporal, Dialogo, ErrorBox, Interruptor, Telefono, useAccion, useCarga, useIntervalo } from '../ui';
import { Calificacion, horasTxt, hoyIso, PERIODOS } from './TecnicoDetalle';

const TURNOS: Record<string, string> = { MATUTINO: 'Matutino', VESPERTINO: 'Vespertino', NOCTURNO: 'Nocturno', COMPLETO: 'Completo' };

function FormTecnico({ inicial, onCerrar, onGuardado }: { inicial: any; onCerrar: () => void; onGuardado: (temporal?: string, nombre?: string) => void }) {
  const { datos: cat } = useCarga('/catalogos');
  const { ejecutar, Aviso, ocupado } = useAccion();
  const [d, setD] = useState<any>(inicial);
  const set = (k: string, v: unknown) => setD({ ...d, [k]: v });
  const alternar = (k: 'categorias' | 'bloques', id: number) =>
    set(k, d[k].includes(id) ? d[k].filter((x: number) => x !== id) : [...d[k], id]);

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      nombres: d.nombres, apellidos: d.apellidos, cedula: d.cedula || null, correo: d.correo, telefono_wa: d.telefono_wa,
      turno: d.turno, max_activos: Number(d.max_activos), categorias: d.categorias, categoria_principal: Number(d.categoria_principal), bloques: d.bloques,
      es_lider: !!d.es_lider,
    };
    await ejecutar(async () => {
      if (d.id_tecnico) {
        await api(`/personal/tecnicos/${d.id_tecnico}`, { method: 'PUT', body });
        onGuardado();
      } else {
        const r = await api('/personal/tecnicos', { method: 'POST', body });
        onGuardado(r.contrasenaTemporal, `${d.nombres} ${d.apellidos}`);
      }
    });
  };

  return (
    <Dialogo titulo={d.id_tecnico ? `Editar a ${d.nombres}` : 'Nuevo técnico'} onCerrar={onCerrar}>
      {!cat ? (
        <Cargando />
      ) : (
        <form className="stack" onSubmit={guardar}>
          <div className="form-grid">
            <Campo id="tc-nom" etiqueta="Nombres"><input id="tc-nom" className="input" required value={d.nombres ?? ''} onChange={(e) => set('nombres', e.target.value)} /></Campo>
            <Campo id="tc-ape" etiqueta="Apellidos"><input id="tc-ape" className="input" required value={d.apellidos ?? ''} onChange={(e) => set('apellidos', e.target.value)} /></Campo>
            <Campo id="tc-mail" etiqueta="Correo (usuario del panel)"><input id="tc-mail" className="input" type="email" required value={d.correo ?? ''} onChange={(e) => set('correo', e.target.value)} /></Campo>
            <Campo id="tc-tel" etiqueta="WhatsApp" ayuda="Celular de 9 dígitos, con o sin el 0 inicial"><Telefono id="tc-tel" required value={d.telefono_wa} onChange={(v) => set('telefono_wa', v)} /></Campo>
            <Campo id="tc-ced" etiqueta="Cédula"><input id="tc-ced" className="input" maxLength={13} value={d.cedula ?? ''} onChange={(e) => set('cedula', e.target.value)} /></Campo>
            <Campo id="tc-turno" etiqueta="Turno">
              <select id="tc-turno" className="input" value={d.turno} onChange={(e) => set('turno', e.target.value)}>
                {Object.entries(TURNOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Campo>
            <Campo id="tc-cupo" etiqueta="Cupo de incidentes activos"><input id="tc-cupo" className="input" type="number" min={1} max={30} value={d.max_activos} onChange={(e) => set('max_activos', e.target.value)} /></Campo>
            <Campo id="tc-principal" etiqueta="Especialidad principal">
              <select id="tc-principal" className="input" value={d.categoria_principal ?? ''} onChange={(e) => set('categoria_principal', e.target.value)}>
                <option value="">Elige…</option>
                {cat.categorias.filter((c: any) => d.categorias.includes(c.id)).map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
          </div>
          <div className="field">
            <label>Especialidades</label>
            <div className="chips">
              {cat.categorias.map((c: any) => (
                <button type="button" key={c.id} className={`chip ${d.categorias.includes(c.id) ? 'on' : ''}`} aria-pressed={d.categorias.includes(c.id)} onClick={() => alternar('categorias', c.id)}>
                  {c.nombre}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Zonas que cubre</label>
            <div className="chips">
              {cat.bloques.map((b: any) => (
                <button type="button" key={b.id} className={`chip ${d.bloques.includes(b.id) ? 'on' : ''}`} aria-pressed={d.bloques.includes(b.id)} onClick={() => alternar('bloques', b.id)}>
                  {b.nombre}
                </button>
              ))}
            </div>
          </div>
          <label className="check" htmlFor="tc-lider">
            <input id="tc-lider" type="checkbox" checked={!!d.es_lider} onChange={(e) => set('es_lider', e.target.checked)} />
            <span>
              <b>Técnico líder</b>
              <span className="small muted" style={{ display: 'block' }}>
                Recibe por WhatsApp todos los reportes con la asignación del sistema y puede cambiar el técnico. Solo hay uno: si lo marcas aquí, deja de serlo el anterior.
              </span>
            </span>
          </label>
          <Aviso />
          <div className="row end">
            <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
            <button className="btn pri" disabled={ocupado || !d.categorias.length || !d.categoria_principal}>Guardar</button>
          </div>
        </form>
      )}
    </Dialogo>
  );
}

/** A08 · Técnicos */
export function Tecnicos() {
  const { datos, error, recargar } = useCarga<any[]>('/personal/tecnicos');
  const [periodo, setPeriodo] = useState('mes');
  const { datos: desempeno, recargar: recargarDesempeno } = useCarga<any>(
    `/personal/tecnicos/desempeno?${new URLSearchParams({ desde: PERIODOS[periodo].desde(), hasta: hoyIso() })}`,
  );
  useIntervalo(() => {
    recargar();
    recargarDesempeno();
  }, 15000);
  const { ejecutar, Aviso } = useAccion();
  const [form, setForm] = useState<any>(null);
  const [temporal, setTemporal] = useState<{ valor: string; para: string } | null>(null);

  if (error) return <ErrorBox msg={error} />;
  if (!datos) return <Cargando />;
  const ind = (id: number) => desempeno?.filas.find((f: any) => f.id_tecnico === id);

  const editar = (t: any) =>
    setForm({
      ...t,
      categorias: t.especialidades.map((e: any) => e.id),
      categoria_principal: t.especialidades.find((e: any) => e.principal)?.id ?? '',
      bloques: t.zonas.map((z: any) => z.id),
    });

  return (
    <>
      <div className="row between">
        <h3>Técnicos</h3>
        <div className="row">
          <select id="tc-periodo" className="input" aria-label="Periodo de los indicadores" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {Object.entries(PERIODOS).map(([k, p]) => <option key={k} value={k}>{p.texto}</option>)}
          </select>
          <button className="btn pri" onClick={() => setForm({ turno: 'MATUTINO', max_activos: 5, categorias: [], bloques: [] })}>+ Nuevo técnico</button>
        </div>
      </div>
      <Aviso />
      <div className="card p0 wrap-x">
        <table className="t">
          <thead>
            <tr>
              <th>Técnico</th><th>Especialidades</th><th>Zonas</th><th>Turno</th><th>Carga</th><th>Pendientes</th><th>Fuera de plazo</th>
              <th>Resueltos</th><th>Tiempo prom.</th><th>Calificación</th><th>Disponible</th><th />
            </tr>
          </thead>
          <tbody>
            {datos.map((t) => (
              <tr key={t.id_tecnico} style={{ opacity: t.activo ? 1 : 0.55 }}>
                <td>
                  <Link to={`/tecnicos/${t.id_tecnico}`}><b>{t.nombres} {t.apellidos}</b></Link>
                  {t.es_lider && <span className="pill n-info" style={{ marginLeft: 6 }}>★ Líder</span>}
                  <div className="small muted mono">{t.telefono_wa}</div>
                </td>
                <td>{t.especialidades.map((e: any, i: number) => <span key={e.id}>{i ? ', ' : ''}{e.principal ? <b>{e.nombre}</b> : e.nombre}</span>)}</td>
                <td>{t.zonas.map((z: any) => z.codigo).join(', ') || 'Todas'}</td>
                <td>{TURNOS[t.turno]}</td>
                <td className="mono">{t.activos ?? 0} / {t.max_activos}</td>
                <td className="mono">{ind(t.id_tecnico) ? ind(t.id_tecnico).por_iniciar + ind(t.id_tecnico).en_proceso : '—'}</td>
                <td className="mono" style={{ color: ind(t.id_tecnico)?.fuera_plazo ? 'var(--bad)' : undefined }}>{ind(t.id_tecnico)?.fuera_plazo ?? '—'}</td>
                <td className="mono">{ind(t.id_tecnico)?.resueltos ?? '—'}</td>
                <td className="mono">{horasTxt(ind(t.id_tecnico)?.horas_promedio)}</td>
                <td><Calificacion v={ind(t.id_tecnico)?.calificacion ?? null} n={ind(t.id_tecnico)?.calificaciones} /></td>
                <td>
                  <Interruptor
                    activo={t.disponible}
                    etiqueta={t.disponible ? 'Marcar no disponible' : 'Marcar disponible'}
                    onCambio={(v) => ejecutar(() => api(`/personal/tecnicos/${t.id_tecnico}/disponible`, { method: 'PATCH', body: { disponible: v } })).then(recargar)}
                  />
                </td>
                <td>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <Link className="btn ghost" to={`/tecnicos/${t.id_tecnico}`}>Ver detalle</Link>
                    <button className="btn ghost" onClick={() => editar(t)}>Editar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="notice n-info">
        Asignación automática: elige el técnico disponible con la especialidad principal de la categoría, que cubra el bloque y tenga menos incidentes activos.
        El <b>técnico líder</b> recibe cada reporte por WhatsApp con esa asignación y puede cambiar el técnico; los demás técnicos reciben un aviso informativo y atienden desde su panel.
      </div>
      {!datos.some((t) => t.es_lider && t.activo) && (
        <div className="notice n-warn">No hay un técnico líder designado: edita un técnico y marca «Técnico líder» para que reciba los reportes.</div>
      )}
      {form && (
        <FormTecnico
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
