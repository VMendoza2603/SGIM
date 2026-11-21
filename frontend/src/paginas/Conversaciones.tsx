import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSesion } from '../auth';
import { Cargando, ErrorBox, Estado, fechaCorta, hora, TextoWhatsApp, TIPO_MIEMBRO, useAccion, useCarga, useDiferido, useIntervalo } from '../ui';

const ESTADO_CONV: Record<string, string> = {
  INICIO: 'Inicio de conversación',
  ESPERANDO_DESCRIPCION: 'Esperando descripción',
  ESPERANDO_UBICACION: 'Esperando ubicación',
  ESPERANDO_FOTO: 'Esperando foto',
  CONFIRMANDO: 'Confirmando datos',
  CONSULTA: 'Consultando estado',
  FINALIZADA: 'Finalizada',
};

const GRUPOS = [
  { id: 'comunidad', texto: 'Comunidad educativa' },
  { id: 'tecnicos', texto: 'Técnicos' },
  // «Comunidad educativa» = estudiantes, docentes y personal administrativo (y números aún no registrados)
] as const;
type Grupo = (typeof GRUPOS)[number]['id'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Atajos de fechas: [desde, hasta] */
const RAPIDOS: Record<string, () => [string, string]> = {
  Hoy: () => [iso(new Date()), iso(new Date())],
  'Últimos 7 días': () => { const h = new Date(); return [iso(new Date(h.getFullYear(), h.getMonth(), h.getDate() - 6)), iso(h)]; },
  'Este mes': () => { const h = new Date(); return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(h)]; },
};

/** A11 · Conversaciones de WhatsApp */
export function Conversaciones() {
  const { puede } = useSesion();
  const [grupo, setGrupo] = useState<Grupo>('comunidad');
  const [tipo, setTipo] = useState('');
  const [buscar, setBuscar] = useState('');
  const q = useDiferido(buscar.trim());
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const fechasValidas = !desde || !hasta || desde <= hasta;
  const filtros = new URLSearchParams({ grupo });
  if (grupo === 'comunidad' && tipo) filtros.set('tipo', tipo);
  if (grupo === 'comunidad' && q) filtros.set('q', q);
  // Fechas para ambos grupos; si el rango está al revés no se envía (se avisa debajo de los campos)
  if (fechasValidas && desde) filtros.set('desde', desde);
  if (fechasValidas && hasta) filtros.set('hasta', hasta);
  const conFechas = fechasValidas && Boolean(desde || hasta);
  const { datos, error, recargar: recargarLista } = useCarga<{ filas: any[]; hay_mas: boolean; totales: Record<Grupo, number> }>(`/conversaciones?${filtros}`);
  const lista = datos?.filas;
  const [sel, setSel] = useState<number | null>(null);
  // Si la conversación elegida no está en el grupo o filtro actual, se abre la primera de la lista
  const actual = (lista?.some((c) => c.id_conversacion === sel) ? sel : lista?.[0]?.id_conversacion) ?? null;
  const { datos: conv, recargar } = useCarga(actual ? `/conversaciones/${actual}` : null);
  const { ejecutar, Aviso, ocupado } = useAccion();
  const [tomada, setTomada] = useState(false);
  const [texto, setTexto] = useState('');
  const chat = useRef<HTMLDivElement>(null);

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
  // (se mueve solo el recuadro del chat, no la página completa)
  useEffect(() => {
    if (chat.current) chat.current.scrollTop = chat.current.scrollHeight;
  }, [cantidad, actual]);

  // Si un refresco falla (red inestable) se mantiene la lista ya cargada; el error ocupa la pantalla solo si nunca cargó
  if (error && !lista) return <ErrorBox msg={error} />;
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
  // En el celular el chat queda debajo de la lista: al elegir una conversación se baja hasta él
  const abrir = (id: number) => {
    setSel(id);
    if (window.matchMedia('(max-width: 900px)').matches) {
      requestAnimationFrame(() => document.getElementById('chat-abierto')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };
  const revision = conv?.incidentes.find((i: any) => i.revision_manual && i.estado === 'PENDIENTE');

  return (
    <>
      <h3>Conversaciones</h3>
      <div className="grid g-aside">
        <div className="card lista-conv" style={{ padding: 6 }}>
          <div className="tabs" role="tablist" aria-label="Tipo de conversación">
            {GRUPOS.map((g) => (
              <button key={g.id} role="tab" aria-selected={grupo === g.id} onClick={() => setGrupo(g.id)} style={{ flex: 1, padding: 'var(--sp-2) var(--sp-1)', textAlign: 'center' }}>
                {g.texto}
                <span className="muted small" style={{ display: 'block' }}>{datos?.totales[g.id] ?? 0} chats</span>
              </button>
            ))}
          </div>
          {grupo === 'comunidad' ? (
            <div className="stack-sm" style={{ padding: 'var(--sp-2) var(--sp-1)' }}>
              <input
                id="conv-buscar"
                className="input"
                type="search"
                aria-label="Buscar por nombre o teléfono"
                placeholder="🔍 Buscar por nombre o teléfono…"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
              />
              <select id="conv-tipo" className="input" aria-label="Tipo de miembro" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="">Todos los miembros</option>
                {Object.entries(TIPO_MIEMBRO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
          ) : (
            puede('tecnico.gestionar') && (
              <div style={{ padding: 'var(--sp-2) var(--sp-1)' }}>
                <Link className="btn block" to="/tecnicos">Ir a Técnicos →</Link>
              </div>
            )
          )}
          <fieldset className="filtro-fechas">
            <legend className="small muted">Buscar por fechas</legend>
            <div className="fechas">
              <label htmlFor="conv-desde" className="small">
                Desde
                <input id="conv-desde" className="input" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
              </label>
              <label htmlFor="conv-hasta" className="small">
                Hasta
                <input id="conv-hasta" className="input" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
              </label>
            </div>
            <div className="chips">
              {Object.entries(RAPIDOS).map(([t, fn]) => {
                const [a, b] = fn();
                return (
                  <button key={t} type="button" className={`chip${desde === a && hasta === b ? ' on' : ''}`} aria-pressed={desde === a && hasta === b} onClick={() => { setDesde(a); setHasta(b); }}>
                    {t}
                  </button>
                );
              })}
              {(desde || hasta) && (
                <button type="button" className="chip" onClick={() => { setDesde(''); setHasta(''); }}>✕ Quitar fechas</button>
              )}
            </div>
            {!fechasValidas && <div className="small" role="alert" style={{ color: 'var(--bad)' }}>La fecha «Desde» no puede ser posterior a «Hasta».</div>}
          </fieldset>
          {(conFechas || (grupo === 'comunidad' && (q || tipo))) && (
            <div className="small muted" role="status" style={{ padding: '0 var(--sp-2)' }}>
              {lista.length}{datos?.hay_mas ? '+' : ''} {lista.length === 1 ? 'conversación encontrada' : 'conversaciones encontradas'}
            </div>
          )}
          <div className="items-conv">
            {lista.length === 0 ? (
              <div className="small muted" style={{ padding: 'var(--sp-2)' }}>
                {conFechas || (grupo === 'comunidad' && (q || tipo))
                  ? 'No hay conversaciones con ese filtro.'
                  : grupo === 'tecnicos'
                    ? 'Ningún técnico ha escrito todavía al número de WhatsApp.'
                    : 'Aún no hay conversaciones. Aparecerán cuando la comunidad escriba al número de WhatsApp.'}
              </div>
            ) : (
              lista.map((c) => (
                <button key={c.id_conversacion} className={c.id_conversacion === actual ? 'on' : ''} aria-current={c.id_conversacion === actual ? 'true' : undefined} onClick={() => abrir(c.id_conversacion)}>
                  <span><b>{c.usuario ?? `+${c.telefono_wa}`}</b> · {fechaCorta(c.ultima_actividad, true)}</span>
                  <span className="muted">{c.estado === 'FINALIZADA' && c.incidente ? `Finalizada → ${c.incidente}` : c.usuario ? ESTADO_CONV[c.estado] : 'Número no registrado'}</span>
                </button>
              ))
            )}
            {datos?.hay_mas && (
              <div className="small muted" style={{ padding: 'var(--sp-2)' }}>
                Se muestran las {lista.length} más recientes. Usa el buscador o las fechas para encontrar las anteriores.
              </div>
            )}
          </div>
        </div>
        {!actual ? (
          <div className="card empty">Elige una conversación de la lista.</div>
        ) : !conv ? (
            <Cargando />
          ) : (
            <div className="card stack" id="chat-abierto">
              <div className="row between">
                <div>
                  <b>{conv.usuario ?? 'Número no registrado'}</b> <span className="mono small muted">+{conv.telefono_wa}</span>
                  <div className="small muted">
                    {conv.id_tecnico ? 'Técnico · ' : conv.tipo_miembro ? `${TIPO_MIEMBRO[conv.tipo_miembro]} · ` : ''}
                    {ESTADO_CONV[conv.estado]}
                  </div>
                </div>
                <div className="row">
                  {conv.id_tecnico && puede('tecnico.gestionar') && (
                    <Link className="btn" to={`/tecnicos/${conv.id_tecnico}`}>Ver técnico →</Link>
                  )}
                  {conv.incidentes.map((i: any) => (
                    <Link key={i.codigo} className="btn" to={`/incidentes/${i.codigo}`}>{i.codigo} <Estado s={i.estado} /></Link>
                  ))}
                </div>
              </div>
              <div className="chat" ref={chat}>
                {conv.mensajes_total > conv.mensajes.length && (
                  <div className="small muted" style={{ textAlign: 'center' }}>
                    Se muestran los últimos {conv.mensajes.length} de {conv.mensajes_total} mensajes.
                  </div>
                )}
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
    </>
  );
}
