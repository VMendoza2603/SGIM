import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useSesion } from '../auth';
import { Cargando, Dialogo, ErrorBox, Estado, fechaCorta, fechaLarga, Foto, hora, Plazo, Prioridad, textoAsignacion, TIPO_MIEMBRO, useIntervalo } from '../ui';

/** Línea de tiempo: estados + asignaciones + prioridad calculada, de lo más reciente a lo más antiguo. */
function eventosDe(inc: any) {
  const ev: { fecha: string; titulo: string; detalle: string }[] = [];
  inc.historial.forEach((h: any) => {
    if (h.hacia_codigo === 'ASIGNADO') return; // la asignación se describe con el técnico
    ev.push({
      fecha: h.creado_en,
      titulo: h.desde ? `Pasó a ${h.hacia}` : `Creado como ${h.hacia}`,
      detalle: [
        h.usuario ?? (h.canal === 'WHATSAPP' && !h.desde ? 'Agente IA vía WhatsApp' : h.canal === 'SISTEMA' ? 'Sistema' : `vía ${h.canal === 'WEB' ? 'panel web' : 'WhatsApp'}`),
        h.desde ? h.comentario : null,
      ].filter(Boolean).join(' · '),
    });
  });
  inc.asignaciones.forEach((a: any) =>
    ev.push({
      fecha: a.asignado_en,
      titulo: `Asignado a ${a.tecnico}`,
      detalle: `${a.automatica || !a.asignado_por ? 'Automática · Sistema' : `Manual · por ${a.asignado_por}`}${a.motivo ? ` · ${a.motivo.toLowerCase()}` : ''}`,
    }),
  );
  if (inc.prioridad && inc.puntaje_prioridad != null) {
    ev.push({ fecha: inc.fecha_reporte, titulo: `Prioridad ${inc.prioridad} (${inc.puntaje_prioridad} pts)`, detalle: inc.prioridad_manual ? 'Corregida por el coordinador' : 'Motor de reglas' });
  }
  return ev.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
}

/** Tiempo estimado en la unidad más natural: 8 horas, 2 días. */
const aTiempo = (horas: number) =>
  horas >= 24 && horas % 24 === 0 ? { valor: horas / 24, unidad: 'dias' } : { valor: Math.round(horas * 10) / 10, unidad: 'horas' };
const horasEntre = (desde: string, hasta: string | null) => (hasta ? (new Date(hasta).getTime() - new Date(desde).getTime()) / 3_600_000 : 0);

/** A03 · Detalle de incidente (coordinador) */
export function Detalle() {
  const { codigo } = useParams();
  const { puede } = useSesion();
  const [inc, setInc] = useState<any>(null);
  const [cat, setCat] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [dialogo, setDialogo] = useState<null | { estado: string; nombre: string; comentario: boolean }>(null);
  const [comentario, setComentario] = useState('');
  const [menu, setMenu] = useState(false);

  const cargar = useCallback(() => {
    api(`/incidentes/${codigo}`)
      .then((d) => {
        setInc(d);
        setForm({
          id_categoria: d.id_categoria,
          id_prioridad: d.id_prioridad,
          id_ubicacion: d.id_ubicacion,
          id_equipo: d.id_equipo,
          id_tecnico: d.id_tecnico,
          tiempo: aTiempo(horasEntre(d.fecha_reporte, d.fecha_limite)),
          tiempoCambiado: false,
        });
      })
      .catch((e) => setError(e.message));
  }, [codigo]);

  useEffect(() => {
    cargar();
    api('/catalogos').then(setCat);
  }, [cargar]);
  // Refresco periódico solo de los datos (no del formulario de reclasificación, para no borrar lo que se edita)
  useIntervalo(() => {
    api(`/incidentes/${codigo}`).then(setInc).catch(() => undefined);
  }, 8000);

  if (error && !inc) return <ErrorBox msg={error} />;
  if (!inc || !cat) return <Cargando />;

  const ejecutar = async (fn: () => Promise<unknown>, ok: string) => {
    setError('');
    setAviso('');
    try {
      await fn();
      setAviso(ok);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const guardar = () =>
    ejecutar(async () => {
      await api(`/incidentes/${inc.id_incidente}/clasificacion`, {
        method: 'PATCH',
        body: {
          id_categoria: form.id_categoria,
          id_prioridad: form.id_prioridad,
          id_ubicacion: form.id_ubicacion,
          id_equipo: form.id_equipo,
          // Solo si el coordinador lo ajustó a mano; si no, rige el plazo de la prioridad
          horas_estimadas: form.tiempoCambiado && form.tiempo.valor > 0 ? form.tiempo.valor * (form.tiempo.unidad === 'dias' ? 24 : 1) : undefined,
        },
      });
      if (form.id_tecnico && form.id_tecnico !== inc.id_tecnico) {
        await api(`/incidentes/${inc.id_incidente}/asignar`, { method: 'POST', body: { id_tecnico: form.id_tecnico } });
      }
    }, 'Cambios guardados. Si cambiaste el técnico, se le avisó por WhatsApp.');

  const cambiarEstado = (estado: string, coment?: string) =>
    ejecutar(() => api(`/incidentes/${inc.id_incidente}/estado`, { method: 'POST', body: { estado, comentario: coment || undefined } }), 'Estado actualizado.');

  const imagen = inc.analisis.find((a: any) => a.tipo === 'IMAGEN') ?? inc.analisis.find((a: any) => a.tipo === 'TEXTO');
  const fotos = inc.evidencias.filter((e: any) => e.tipo === 'REPORTE');
  const anomalias: string[] = imagen?.anomalias ?? [];
  const equiposUbic = cat.equipos.filter((e: any) => e.id_ubicacion === form.id_ubicacion);
  const transiciones = inc.transiciones.filter((t: any) => t.codigo !== 'CANCELADO');
  const puedeCancelar = inc.transiciones.some((t: any) => t.codigo === 'CANCELADO');
  const num = (v: string) => (v ? Number(v) : null);

  return (
    <>
      <div className="crumb"><Link to="/incidentes">Incidentes</Link> / {inc.codigo}</div>
      <div className="row between">
        <div>
          <h3>{inc.titulo}</h3>
          <div className="row small muted" style={{ marginTop: 4 }}>
            <span className="mono">{inc.codigo}</span>· {inc.canal === 'WHATSAPP' ? 'WhatsApp' : 'Web'} · {fechaLarga(inc.fecha_reporte)} · <Prioridad p={inc.prioridad} /> <Estado s={inc.estado} />
            · <span>Tiempo estimado:</span> <Plazo inc={inc} />
          </div>
          {inc.asignacion_actual && <div className="small muted" style={{ marginTop: 4 }}>{textoAsignacion(inc.asignacion_actual)}</div>}
        </div>
        <div className="row">
          {puede('incidente.asignar') && !inc.es_final && (
            <button className="btn" onClick={() => document.getElementById('cl-tecnico')?.focus()}>Reasignar</button>
          )}
          {transiciones.length > 0 && (
            <div className="menu">
              <button className="btn" onClick={() => setMenu(!menu)} aria-expanded={menu}>Cambiar estado ▾</button>
              {menu && (
                <div className="items">
                  {transiciones.map((t: any) => (
                    <button
                      key={t.codigo}
                      onClick={() => {
                        setMenu(false);
                        if (t.requiere_comentario) setDialogo({ estado: t.codigo, nombre: t.nombre, comentario: true });
                        else cambiarEstado(t.codigo);
                      }}
                    >
                      → {t.nombre}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {puedeCancelar && (
            <button className="btn danger" onClick={() => setDialogo({ estado: 'CANCELADO', nombre: 'Cancelado', comentario: true })}>Cancelar</button>
          )}
        </div>
      </div>
      {aviso && <div className="notice n-ok">{aviso}</div>}
      {error && <ErrorBox msg={error} />}

      <div className="grid g-main">
        <div className="grid">
          <div className="card">
            <h4>Reporte original</h4>
            <div className="small" style={{ marginBottom: 8 }}>“{inc.descripcion}”</div>
            {fotos.length > 0 && (
              <div className="grid g3">
                {fotos.map((f: any) => (
                  <Foto key={f.id_evidencia} url={f.url_archivo} texto={<>Foto del reporte<br />{f.descripcion}</>} />
                ))}
              </div>
            )}
            <div className="small muted" style={{ marginTop: 6 }}>
              Reportado por <b>{inc.reportante}</b> ({TIPO_MIEMBRO[inc.tipo_miembro] ?? 'Comunidad'}) · {inc.reportante_telefono}
            </div>
            {!inc.id_ubicacion && inc.ubicacion_texto && (
              <div className="notice n-warn" style={{ marginTop: 8 }}>Ubicación no reconocida por el agente: “{inc.ubicacion_texto}”. Selecciónala en Clasificación.</div>
            )}
          </div>

          {(inc.diagnostico_preliminar || imagen) && (
            <div className="ia">
              <span className="h">Análisis del agente IA</span>
              <div>{inc.diagnostico_preliminar ?? imagen?.interpretacion}</div>
              <dl className="kv">
                <dt>Categoría</dt><dd>{imagen?.categoria_sugerida ?? inc.categoria ?? '—'}</dd>
                {imagen?.tipo_equipo_detectado && (<><dt>Equipo detectado</dt><dd>{imagen.tipo_equipo_detectado}</dd></>)}
                {anomalias.length > 0 && (<><dt>Anomalías</dt><dd>{anomalias.join(' · ')}</dd></>)}
                {imagen?.confianza != null && (
                  <>
                    <dt>Confianza</dt>
                    <dd><span className="meter"><span style={{ width: `${imagen.confianza * 100}%` }} /></span> {imagen.confianza.toFixed(2).replace('.', ',')}</dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {inc.reglas.length > 0 && (
            <div className="card">
              <h4>¿Por qué prioridad {inc.prioridad}? <span className="muted small">(puntaje {inc.puntaje_prioridad})</span></h4>
              <div className="wrap-x">
                <table className="t">
                  <tbody>
                    {inc.reglas.map((r: any) => (
                      <tr key={r.nombre}>
                        <td>{r.nombre}</td>
                        <td className="mono">+{r.puntos_aplicados}</td>
                        <td>{r.fuerza && <span className={`pill p-${r.fuerza}`}>Fuerza {r.fuerza}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="grid">
          <div className="card">
            <h4>Clasificación {puede('incidente.reclasificar') && <span className="muted small">(editable)</span>}</h4>
            <div className="grid">
              <div className="field">
                <label htmlFor="cl-categoria">Categoría</label>
                <select id="cl-categoria" className="input" value={form.id_categoria ?? ''} onChange={(e) => setForm({ ...form, id_categoria: num(e.target.value) })}>
                  <option value="">Sin categoría</option>
                  {cat.categorias.map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="cl-prioridad">Prioridad</label>
                <select
                  id="cl-prioridad"
                  className="input"
                  value={form.id_prioridad ?? ''}
                  onChange={(e) => {
                    const id = num(e.target.value);
                    const p = cat.prioridades.find((x: any) => x.id === id);
                    // Si no se ajustó a mano, el tiempo estimado sigue al plazo de la nueva prioridad
                    setForm({ ...form, id_prioridad: id, tiempo: !form.tiempoCambiado && p ? aTiempo(p.horas_solucion) : form.tiempo });
                  }}
                >
                  <option value="">Sin prioridad</option>
                  {cat.prioridades.map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="cl-tiempo">Tiempo estimado de reparación</label>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input
                    id="cl-tiempo"
                    className="input"
                    type="number"
                    min="0.5"
                    step="0.5"
                    disabled={inc.es_final}
                    value={form.tiempo.valor}
                    onChange={(e) => setForm({ ...form, tiempo: { ...form.tiempo, valor: Number(e.target.value) }, tiempoCambiado: true })}
                  />
                  <select
                    id="cl-tiempo-unidad"
                    aria-label="Unidad del tiempo estimado"
                    className="input"
                    style={{ width: 'auto' }}
                    disabled={inc.es_final}
                    value={form.tiempo.unidad}
                    onChange={(e) => setForm({ ...form, tiempo: { ...form.tiempo, unidad: e.target.value }, tiempoCambiado: true })}
                  >
                    <option value="horas">horas</option>
                    <option value="dias">días</option>
                  </select>
                </div>
                <span className="muted">Se cuenta desde el reporte. Por defecto, el plazo de la prioridad (Configuración).</span>
              </div>
              <div className="field">
                <label htmlFor="cl-ubicacion">Ubicación</label>
                <select id="cl-ubicacion" className="input" value={form.id_ubicacion ?? ''} onChange={(e) => setForm({ ...form, id_ubicacion: num(e.target.value), id_equipo: null })}>
                  <option value="">Sin ubicación</option>
                  {cat.ubicaciones.map((u: any) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="cl-equipo">Equipo</label>
                <select id="cl-equipo" className="input" value={form.id_equipo ?? ''} onChange={(e) => setForm({ ...form, id_equipo: num(e.target.value) })}>
                  <option value="">Sin asignar</option>
                  {equiposUbic.map((q: any) => <option key={q.id} value={q.id}>{q.codigo} · {q.tipo}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="cl-tecnico">Técnico asignado</label>
                <select id="cl-tecnico" className="input" disabled={inc.es_final} value={form.id_tecnico ?? ''} onChange={(e) => setForm({ ...form, id_tecnico: num(e.target.value) })}>
                  <option value="">Sin asignar</option>
                  {cat.tecnicos.map((t: any) => (
                    <option key={t.id} value={t.id} disabled={!t.disponible}>
                      {t.nombre} ({t.activos}/{t.max_activos}){t.disponible ? '' : ' · no disponible'}
                    </option>
                  ))}
                </select>
              </div>
              {puede('incidente.reclasificar') && (
                <button className="btn dark block" onClick={guardar}>Guardar cambios</button>
              )}
            </div>
          </div>
          <div className="card">
            <h4>Historial</h4>
            <div className="timeline">
              {eventosDe(inc).map((e, i) => (
                <div className="ev" key={i}>
                  <i />
                  <div>
                    <b>{e.titulo}</b>
                    <div className="muted">{e.detalle} · {hora(e.fecha)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {dialogo && (
        <Dialogo titulo={dialogo.estado === 'CANCELADO' ? 'Cancelar incidente' : `Cambiar a ${dialogo.nombre}`} onCerrar={() => setDialogo(null)}>
          <div className="field">
            <label htmlFor="dl-motivo">Motivo</label>
            <textarea id="dl-motivo" className="input" value={comentario} onChange={(e) => setComentario(e.target.value)} autoFocus />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setDialogo(null)}>Volver</button>
            <button
              className={`btn ${dialogo.estado === 'CANCELADO' ? 'danger' : 'pri'}`}
              disabled={!comentario.trim()}
              onClick={() => {
                cambiarEstado(dialogo.estado, comentario);
                setDialogo(null);
                setComentario('');
              }}
            >
              Confirmar
            </button>
          </div>
        </Dialogo>
      )}
    </>
  );
}
