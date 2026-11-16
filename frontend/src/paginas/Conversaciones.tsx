import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Cargando, ErrorBox, Estado, fechaCorta, hora, TextoWhatsApp, useAccion, useCarga, useIntervalo } from '../ui';

const ESTADO_CONV: Record<string, string> = {
  INICIO: 'Inicio de conversación',
  ESPERANDO_DESCRIPCION: 'Esperando descripción',
  ESPERANDO_UBICACION: 'Esperando ubicación',
  ESPERANDO_FOTO: 'Esperando foto',
  CONFIRMANDO: 'Confirmando datos',
  CONSULTA: 'Consultando estado',
  FINALIZADA: 'Finalizada',
};

/** A11 · Conversaciones de WhatsApp */
export function Conversaciones() {
  const { datos: lista, error, recargar: recargarLista } = useCarga<any[]>('/conversaciones');
  const [sel, setSel] = useState<number | null>(null);
  const actual = sel ?? lista?.[0]?.id_conversacion ?? null;
  const { datos: conv, recargar } = useCarga(actual ? `/conversaciones/${actual}` : null);
  const { ejecutar, Aviso, ocupado } = useAccion();
  const [tomada, setTomada] = useState(false);
  const [texto, setTexto] = useState('');
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTomada(false);
  }, [actual]);
  // Actualización casi en tiempo real: lista y chat abierto se refrescan cada 4 s
  useIntervalo(() => {
    recargarLista();
    if (actual) recargar();
  }, 4000);
  // Solo baja al final cuando llega un mensaje nuevo o se cambia de conversación (no en cada refresco)
  const cantidad = conv?.mensajes.length ?? 0;
  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' });
  }, [cantidad, actual]);

  if (error) return <ErrorBox msg={error} />;
  if (!lista) return <Cargando />;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!texto.trim()) return;
    const ok = await ejecutar(() => api(`/conversaciones/${actual}/mensajes`, { method: 'POST', body: { texto } }));
    if (ok) {
      setTexto('');
      recargar();
      recargarLista();
    }
  };
  const revision = conv?.incidentes.find((i: any) => i.revision_manual && i.estado === 'PENDIENTE');

  return (
    <>
      <h3>Conversaciones</h3>
      {lista.length === 0 ? (
        <div className="card empty">Aún no hay conversaciones. Aparecerán cuando la comunidad escriba al número de WhatsApp.</div>
      ) : (
        <div className="grid g-aside">
          <div className="card lista-conv" style={{ padding: 6 }}>
            {lista.map((c) => (
              <button key={c.id_conversacion} className={c.id_conversacion === actual ? 'on' : ''} onClick={() => setSel(c.id_conversacion)}>
                <span><b>{c.usuario ?? `+${c.telefono_wa}`}</b> · {fechaCorta(c.ultima_actividad, true)}</span>
                <span className="muted">{c.estado === 'FINALIZADA' && c.incidente ? `Finalizada → ${c.incidente}` : c.usuario ? ESTADO_CONV[c.estado] : 'Número no registrado'}</span>
              </button>
            ))}
          </div>
          {!conv ? (
            <Cargando />
          ) : (
            <div className="card stack">
              <div className="row between">
                <div>
                  <b>{conv.usuario ?? 'Número no registrado'}</b> <span className="mono small muted">+{conv.telefono_wa}</span>
                  <div className="small muted">{ESTADO_CONV[conv.estado]}</div>
                </div>
                <div className="row">
                  {conv.incidentes.map((i: any) => (
                    <Link key={i.codigo} className="btn" to={`/incidentes/${i.codigo}`}>{i.codigo} <Estado s={i.estado} /></Link>
                  ))}
                </div>
              </div>
              <div className="chat">
                {conv.mensajes.map((m: any) => (
                  <div key={m.id_mensaje} className={`msg ${m.direccion === 'SALIENTE' ? 'out' : ''}`}>
                    {m.tipo === 'IMAGEN' ? (
                      m.media_url ? (
                        <>
                          <a href={m.media_url} target="_blank" rel="noreferrer">
                            <img src={m.media_url} alt="Foto enviada por WhatsApp" style={{ maxWidth: 220, borderRadius: 'var(--r)', display: 'block' }} />
                          </a>
                          {m.contenido && m.contenido !== '[Foto]' && (
                            <span style={{ whiteSpace: 'pre-line', display: 'block', marginTop: 'var(--sp-2)' }}>
                              <TextoWhatsApp texto={m.contenido} />
                            </span>
                          )}
                        </>
                      ) : (
                        <i className="muted">📷 Foto</i>
                      )
                    ) : (
                      <span style={{ whiteSpace: 'pre-line' }}><TextoWhatsApp texto={m.contenido ?? ''} /></span>
                    )}
                    <span className="tm">
                      {hora(m.creado_en)}
                      {m.direccion === 'SALIENTE' && (m.estado === 'FALLIDO' ? ' ⚠ no entregado' : m.estado === 'LEIDO' ? ' ✓✓ leído' : ' ✓✓')}
                    </span>
                  </div>
                ))}
                <div ref={fin} />
              </div>
              {revision && <div className="notice n-warn">El agente no pudo resolver la ubicación. El incidente {revision.codigo} quedó en revisión manual.</div>}
              <Aviso />
              {tomada ? (
                <form className="row" onSubmit={enviar}>
                  <input id="conv-texto" className="input grow" placeholder="Escribe tu respuesta…" value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
                  <button className="btn pri" disabled={ocupado || !texto.trim()}>Enviar</button>
                </form>
              ) : (
                <div className="row">
                  {revision && <Link className="btn" to={`/incidentes/${revision.codigo}`}>Abrir incidente</Link>}
                  <button className="btn" onClick={() => setTomada(true)}>Tomar conversación</button>
                </div>
              )}
              <div className="small muted">Los mensajes son evidencia y no se pueden borrar.</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
