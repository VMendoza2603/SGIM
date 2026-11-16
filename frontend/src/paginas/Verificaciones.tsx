import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Cargando, Dialogo, ErrorBox, Estado, fechaCorta, Foto, useAccion, useCarga, useIntervalo } from '../ui';

const RESULTADO: Record<string, { texto: string; color: string }> = {
  APROBADA: { texto: 'Aprobada', color: 'var(--ok)' },
  RECHAZADA: { texto: 'Rechazada', color: 'var(--bad)' },
  PENDIENTE: { texto: 'Pendiente de análisis', color: 'var(--ink-2)' },
};

/** A04 · Verificación de cierres */
export function Verificaciones() {
  const { datos, error, recargar } = useCarga<any[]>('/verificaciones');
  // Se actualiza sola: la confirmación del reportante llega por WhatsApp
  useIntervalo(recargar, 8000);
  const { ejecutar, Aviso } = useAccion();
  const [rechazo, setRechazo] = useState<any>(null);
  const [motivo, setMotivo] = useState('');

  const decidir = (inc: any, estado: 'RESUELTO' | 'EN_PROCESO', comentario?: string) =>
    ejecutar(
      () => api(`/incidentes/${inc.id_incidente}/estado`, { method: 'POST', body: { estado, comentario } }),
      estado === 'RESUELTO' ? `${inc.codigo} quedó resuelto.` : `${inc.codigo} volvió al técnico.`,
    ).then((ok) => ok && recargar());

  if (error) return <ErrorBox msg={error} />;
  if (!datos) return <Cargando />;

  return (
    <>
      <h3>Cierres por verificar</h3>
      <Aviso />
      {datos.length === 0 && <div className="card empty">No hay cierres pendientes de verificación.</div>}
      {datos.map((v) => {
        const r = RESULTADO[v.verificacion?.resultado ?? 'PENDIENTE'];
        return (
          <div className="card stack" key={v.id_incidente}>
            <div className="row between">
              <div>
                <Link to={`/incidentes/${v.codigo}`}><b>{v.codigo} · {v.titulo}</b></Link>
                <div className="small muted">
                  {v.ubicacion_codigo} · {v.ubicacion} · {v.tecnico} · cerrado {fechaCorta(v.fecha_resolucion, true)}
                </div>
              </div>
              <Estado s="EN_VERIFICACION" />
            </div>
            <div className="grid g2">
              <div className="stack-sm">
                <div className="small muted">Antes (reporte)</div>
                <Foto url={v.antes?.url} texto={v.antes?.descripcion ?? 'Sin foto del reporte'} />
              </div>
              <div className="stack-sm">
                <div className="small muted">Después (evidencia de cierre)</div>
                <Foto url={v.despues?.url} texto={v.despues?.descripcion ?? 'Sin foto de cierre'} />
              </div>
            </div>
            <div className="grid g3">
              <div className="ia">
                <span className="h">Verificación IA</span>
                <div>{v.interpretacion_ia ?? 'El agente aún no analizó la foto de cierre.'}</div>
                <b style={{ color: r.color }}>
                  {r.texto}{v.verificacion?.confianza != null ? ` · ${v.verificacion.confianza.toFixed(2).replace('.', ',')}` : ''}
                </b>
              </div>
              <div className="card">
                <h4>Reportante</h4>
                <div className="small">
                  {v.verificacion?.confirmacion == null ? (
                    <>{v.reportante} aún no responde.</>
                  ) : v.verificacion.confirmacion ? (
                    <>{v.reportante} respondió <b>“Sí, quedó solucionado”</b>{v.calificacion ? ` · ${'★'.repeat(v.calificacion)}` : ''}</>
                  ) : (
                    <>{v.reportante} indicó que <b>sigue fallando</b>.</>
                  )}
                </div>
              </div>
              <div className="card">
                <h4>Acción registrada</h4>
                <div className="small">{v.accion ? `${v.accion.tipo === 'CORRECTIVA' ? 'Correctiva' : 'Preventiva'}: ${v.accion.descripcion}` : 'Sin acciones registradas.'}</div>
              </div>
            </div>
            <div className="row end">
              <button className="btn danger" onClick={() => setRechazo(v)}>Rechazar y devolver al técnico</button>
              <button className="btn pri" disabled={!v.despues} onClick={() => decidir(v, 'RESUELTO')}>Aprobar cierre → Resuelto</button>
            </div>
          </div>
        );
      })}
      <div className="notice n-info">
        Si la IA aprueba con una confianza de 0,80 o más y el reportante confirma, el incidente se cierra automáticamente. Aquí solo llegan los casos con
        dudas o los que nadie confirmó en 24 h.
      </div>

      {rechazo && (
        <Dialogo titulo={`Rechazar cierre de ${rechazo.codigo}`} onCerrar={() => setRechazo(null)}>
          <div className="field">
            <label htmlFor="vr-motivo">¿Qué debe corregir el técnico?</label>
            <textarea id="vr-motivo" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
          </div>
          <div className="row end">
            <button className="btn" onClick={() => setRechazo(null)}>Volver</button>
            <button
              className="btn danger"
              disabled={!motivo.trim()}
              onClick={() => {
                decidir(rechazo, 'EN_PROCESO', motivo);
                setRechazo(null);
                setMotivo('');
              }}
            >
              Devolver al técnico
            </button>
          </div>
        </Dialogo>
      )}
    </>
  );
}
