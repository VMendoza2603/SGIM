import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Cargando, ErrorBox, Estado, fechaCorta, Foto, Plazo, Prioridad, textoAsignacion, TIPO_MIEMBRO, useIntervalo } from '../ui';

const TIPOS_ACCION = [
  { v: 'CORRECTIVA', t: 'Correctiva' },
  { v: 'DIAGNOSTICO', t: 'Diagnóstico' },
  { v: 'PREVENTIVA', t: 'Preventiva' },
  { v: 'OBSERVACION', t: 'Observación' },
];

/**
 * Lee la foto y la reduce a 1600 px como máximo (JPEG): una foto de celular pasa de 4–8 MB a unos 300 KB.
 * Así sube rápido y entra en el límite de 4,5 MB por petición de Vercel.
 */
const leerArchivo = (f: File) =>
  new Promise<string>((ok, mal) => {
    const r = new FileReader();
    r.onerror = () => mal(new Error('No se pudo leer la foto'));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => mal(new Error('El archivo no es una imagen válida'));
      img.onload = () => {
        const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
        const lienzo = document.createElement('canvas');
        lienzo.width = Math.round(img.width * escala);
        lienzo.height = Math.round(img.height * escala);
        lienzo.getContext('2d')!.drawImage(img, 0, 0, lienzo.width, lienzo.height);
        ok(lienzo.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(r.result);
    };
    r.readAsDataURL(f);
  });

/** Celular o tableta (pantalla táctil): ahí se ofrece abrir la cámara directamente. En la computadora solo se elige un archivo. */
const esTactil = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/** T02 · Atender incidente (técnico) */
export function Atender() {
  const { codigo } = useParams();
  const [inc, setInc] = useState<any>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [tipo, setTipo] = useState('CORRECTIVA');
  const [descripcion, setDescripcion] = useState('');
  const [materiales, setMateriales] = useState('');
  const [tipoFoto, setTipoFoto] = useState<'AVANCE' | 'CIERRE'>('CIERRE');
  const archivo = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);

  const cargar = useCallback(() => {
    api(`/incidentes/${codigo}`).then(setInc).catch((e) => setError(e.message));
  }, [codigo]);
  useEffect(cargar, [cargar]);
  useIntervalo(cargar, 8000);

  if (error && !inc) return <ErrorBox msg={error} />;
  if (!inc) return <Cargando />;

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
  const estado = (e: string, comentario?: string) =>
    ejecutar(() => api(`/incidentes/${inc.id_incidente}/estado`, { method: 'POST', body: { estado: e, comentario } }), 'Estado actualizado.');

  const subirFotos = async (files: FileList | null) => {
    if (!files?.length) return;
    await ejecutar(async () => {
      for (const f of Array.from(files)) {
        await api(`/incidentes/${inc.id_incidente}/evidencias`, { method: 'POST', body: { tipo: tipoFoto, imagen: await leerArchivo(f), descripcion: f.name } });
      }
    }, `Foto${files.length > 1 ? 's' : ''} de ${tipoFoto === 'CIERRE' ? 'cierre' : 'avance'} subida${files.length > 1 ? 's' : ''}.`);
    if (archivo.current) archivo.current.value = '';
    if (camara.current) camara.current.value = '';
  };

  const guardarAccion = () =>
    ejecutar(async () => {
      await api(`/incidentes/${inc.id_incidente}/acciones`, { method: 'POST', body: { tipo, descripcion, materiales: materiales || undefined } });
      setDescripcion('');
      setMateriales('');
    }, 'Acción registrada.');

  const enProceso = inc.estado === 'EN_PROCESO';
  const fotosReporte = inc.evidencias.filter((e: any) => e.tipo === 'REPORTE');
  const fotosTecnico = inc.evidencias.filter((e: any) => e.tipo !== 'REPORTE');
  const tieneCierre = inc.evidencias.some((e: any) => e.tipo === 'CIERRE');
  const puede = (e: string) => inc.transiciones.some((t: any) => t.codigo === e);
  const linea = [
    ...inc.acciones.map((a: any) => ({ fecha: a.creado_en, titulo: TIPOS_ACCION.find((t) => t.v === a.tipo)?.t ?? a.tipo, detalle: a.descripcion + (a.materiales ? ` · ${a.materiales}` : '') })),
    ...inc.historial
      .filter((h: any) => h.hacia_codigo === 'EN_PROCESO' && h.desde)
      .map((h: any) => ({ fecha: h.creado_en, titulo: 'Inició atención', detalle: h.canal === 'WHATSAPP' ? 'vía WhatsApp' : 'vía panel web' })),
  ].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

  return (
    <>
      <div className="crumb"><Link to="/mis-incidentes">Mis incidentes</Link> / {inc.codigo}</div>
      <div className="row between">
        <div>
          <h3>{inc.titulo}</h3>
          <div className="row small muted" style={{ marginTop: 4 }}>
            <span className="mono">{inc.codigo}</span>· <Prioridad p={inc.prioridad} /> <Estado s={inc.estado} />
            · <span className="small">Tiempo estimado:</span> <Plazo inc={inc} />
          </div>
          {inc.asignacion_actual && <div className="small muted" style={{ marginTop: 4 }}>{textoAsignacion(inc.asignacion_actual)}</div>}
        </div>
        <div className="row">
          {puede('EN_PROCESO') && <button className="btn pri" onClick={() => estado('EN_PROCESO')}>Iniciar atención</button>}
          {puede('EN_VERIFICACION') && (
            <button className="btn pri" disabled={!tieneCierre} title={tieneCierre ? '' : 'Sube primero una foto de cierre'} onClick={() => estado('EN_VERIFICACION')}>
              Terminar y enviar a verificación
            </button>
          )}
        </div>
      </div>
      {aviso && <div className="notice n-ok">{aviso}</div>}
      {error && <ErrorBox msg={error} />}

      <div className="grid g-main">
        <div className="grid">
          <div className="card">
            <h4>Reporte</h4>
            <div className="small">“{inc.descripcion}”</div>
            {fotosReporte.length > 0 && (
              <div className="grid g3" style={{ marginTop: 8 }}>
                {fotosReporte.map((f: any) => <Foto key={f.id_evidencia} url={f.url_archivo} texto={<>Foto del reporte<br />{f.descripcion}</>} />)}
              </div>
            )}
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Ubicación</dt><dd>{inc.ubicacion_codigo ? `${inc.ubicacion_codigo} · ${inc.ubicacion}` : inc.ubicacion_texto}</dd>
              <dt>Equipo</dt><dd>{inc.equipo_codigo ? <><Link to={`/equipos/${inc.equipo_codigo}`}>{inc.equipo_codigo}</Link> · {[inc.equipo_marca, inc.equipo_modelo].filter(Boolean).join(' ')}</> : 'Sin equipo registrado'}</dd>
            </dl>
          </div>

          {inc.diagnostico_preliminar && (
            <div className="ia">
              <span className="h">Diagnóstico preliminar (IA)</span>
              <div>{inc.diagnostico_preliminar}</div>
              <div className="small muted">Es una orientación y no reemplaza la evaluación técnica.</div>
            </div>
          )}

          {enProceso && (
            <div className="card">
              <h4>Registrar acción</h4>
              <div className="grid g2">
                <div className="field">
                  <label htmlFor="ac-tipo">Tipo</label>
                  <select id="ac-tipo" className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    {TIPOS_ACCION.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ac-foto">Fotos</label>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <select id="ac-foto-tipo" className="input" style={{ width: 110 }} value={tipoFoto} onChange={(e) => setTipoFoto(e.target.value as 'AVANCE' | 'CIERRE')} aria-label="Tipo de foto">
                      <option value="CIERRE">Cierre</option>
                      <option value="AVANCE">Avance</option>
                    </select>
                    {/* En el celular: tomar la foto en el momento (abre la cámara trasera) o elegir una ya tomada */}
                    {esTactil && (
                      <button type="button" className="btn" style={{ flex: '1 1 130px', justifyContent: 'center' }} onClick={() => camara.current?.click()}>📷 Tomar foto</button>
                    )}
                    <button type="button" className="btn" style={{ flex: '1 1 130px', justifyContent: 'center' }} onClick={() => archivo.current?.click()}>
                      {esTactil ? '🖼️ Elegir de galería' : '📷 Subir avance / cierre'}
                    </button>
                    <input id="ac-foto" ref={archivo} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => subirFotos(e.target.files)} />
                    <input id="ac-camara" ref={camara} type="file" accept="image/*" capture="environment" hidden aria-label="Tomar foto con la cámara" onChange={(e) => subirFotos(e.target.files)} />
                  </div>
                </div>
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor="ac-desc">Descripción del trabajo</label>
                <textarea id="ac-desc" className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej.: Limpieza de filtros y recarga de gas R410A." />
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor="ac-mat">Materiales utilizados</label>
                <input id="ac-mat" className="input" value={materiales} onChange={(e) => setMateriales(e.target.value)} placeholder="Ej.: Gas R410A 1 kg, filtro" />
              </div>
              {fotosTecnico.length > 0 && (
                <div className="grid g3" style={{ marginTop: 8 }}>
                  {fotosTecnico.map((f: any) => <Foto key={f.id_evidencia} url={f.url_archivo} texto={`${f.tipo === 'CIERRE' ? 'Cierre' : 'Avance'} · ${f.descripcion ?? ''}`} />)}
                </div>
              )}
              <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
                <button className="btn dark" disabled={descripcion.trim().length < 3} onClick={guardarAccion}>Guardar acción</button>
              </div>
            </div>
          )}
        </div>

        <div className="grid">
          <div className="card">
            <h4>Clasificación</h4>
            <dl className="kv">
              <dt>Categoría</dt><dd>{inc.categoria ?? '—'} <span className="lock">🔒</span></dd>
              <dt>Prioridad</dt><dd>{inc.prioridad ? inc.prioridad[0] + inc.prioridad.slice(1).toLowerCase() : '—'} <span className="lock">🔒</span></dd>
              <dt>Reportante</dt><dd>{inc.reportante.split(' ')[0]} {inc.reportante.split(' ')[1]?.[0]}. · {TIPO_MIEMBRO[inc.tipo_miembro] ?? 'Comunidad'}</dd>
            </dl>
            <div className="small muted" style={{ marginTop: 6 }}>Si la clasificación no es correcta, avisa al coordinador con un comentario.</div>
          </div>
          <div className="card">
            <h4>Acciones registradas</h4>
            {linea.length === 0 ? (
              <div className="small muted">Aún no hay acciones.</div>
            ) : (
              <div className="timeline">
                {linea.map((e, i) => (
                  <div className="ev" key={i}>
                    <i />
                    <div><b>{e.titulo}</b> · {fechaCorta(e.fecha)}<div className="muted">{e.detalle}</div></div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {enProceso && !tieneCierre && <div className="notice n-warn">Para terminar debes subir al menos una foto de cierre del equipo funcionando.</div>}
          {inc.estado === 'EN_VERIFICACION' && <div className="notice n-info">Enviado a verificación. El coordinador o el reportante confirmarán la solución.</div>}
        </div>
      </div>
    </>
  );
}
