import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Cargando, ErrorBox, Estado, LeyendaPlazo, Plazo, Prioridad, useIntervalo } from '../ui';
import { TablaDesempeno } from './TecnicoDetalle';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const horas = (h: number | null | undefined) => (h == null ? '—' : `${String(h).replace('.', ',')} h`);

/** A01 · Dashboard del coordinador */
export function Dashboard() {
  const navigate = useNavigate();
  const [d, setD] = useState<any>(null);
  const [atencion, setAtencion] = useState<any[]>([]);
  const [error, setError] = useState('');

  const cargar = () =>
    Promise.all([api('/dashboard'), api('/incidentes?activos=1&porPagina=5')])
      .then(([dash, inc]) => {
        setD(dash);
        setAtencion(inc.filas);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    cargar();
  }, []);
  useIntervalo(() => void cargar(), 15000);

  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Cargando />;
  const k = d.kpi;
  const ahora = new Date();
  const maxCat = Math.max(1, ...d.porCategoria.map((c: any) => c.total));
  const variacion = k.horas_promedio_resolucion != null && k.horas_mes_anterior != null ? k.horas_promedio_resolucion - k.horas_mes_anterior : null;

  return (
    <>
      <div className="row between">
        <div>
          <h3>Resumen de mantenimiento</h3>
          <div className="crumb">{MESES[ahora.getMonth()]} {ahora.getFullYear()} · Todas las sedes</div>
        </div>
        <div className="filters">
          <select id="dash-sede" className="input" defaultValue="matriz" aria-label="Sede">
            <option value="matriz">Sede: Matriz</option>
          </select>
          <select id="dash-periodo" className="input" defaultValue="mes" aria-label="Periodo">
            <option value="mes">Este mes</option>
          </select>
        </div>
      </div>

      <div className="grid g4">
        <div className="card kpi">
          <div className="l">Pendientes de asignar</div>
          <div className="v">{k.pendientes}</div>
          <div className="d muted">{k.revision_manual} requiere{k.revision_manual === 1 ? '' : 'n'} revisión manual</div>
        </div>
        <div className="card kpi">
          <div className="l">En atención</div>
          <div className="v">{k.en_atencion}</div>
          <div className="d muted">{k.tecnicos_activos} técnicos activos</div>
        </div>
        <div className="card kpi">
          <div className="l">Fuera de plazo</div>
          <div className="v" style={{ color: k.sla_vencidos ? 'var(--bad)' : undefined }}>{k.sla_vencidos}</div>
          <div className="d sla-bad">{k.primer_vencido ?? ''}</div>
        </div>
        <div className="card kpi">
          <div className="l">Tiempo medio de solución</div>
          <div className="v">{horas(k.horas_promedio_resolucion)}</div>
          {variacion != null && (
            <div className="d" style={{ color: variacion <= 0 ? 'var(--ok)' : 'var(--bad)' }}>
              {variacion <= 0 ? '▼' : '▲'} {horas(Math.abs(Math.round(variacion * 10) / 10))} vs. {MESES[(ahora.getMonth() + 11) % 12].toLowerCase()}
            </div>
          )}
        </div>
      </div>

      <div className="grid g-main">
        <div className="card">
          <h4>Incidentes que necesitan atención</h4>
          <LeyendaPlazo />
          {atencion.length === 0 ? (
            <div className="empty">No hay incidentes abiertos.</div>
          ) : (
            <div className="wrap-x">
              <table className="t">
                <thead>
                  <tr><th>Código</th><th>Incidente</th><th>Prioridad</th><th>Estado</th><th>Tiempo estimado</th></tr>
                </thead>
                <tbody>
                  {atencion.map((i) => (
                    <tr key={i.id_incidente} className="click" onClick={() => navigate(`/incidentes/${i.codigo}`)}>
                      <td className="mono">{i.codigo.slice(-6)}</td>
                      <td>
                        {i.titulo}
                        <div className="muted small">{i.ubicacion_codigo ? `${i.ubicacion_codigo} · ${i.ubicacion}` : `“${i.ubicacion_texto}”`}</div>
                      </td>
                      <td><Prioridad p={i.prioridad} /></td>
                      <td><Estado s={i.estado} /></td>
                      <td className="small"><Plazo inc={i} corto /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="grid">
          <div className="card">
            <h4>Por categoría (mes)</h4>
            <div className="bars">
              {d.porCategoria.map((c: any) => (
                <div className="b" key={c.nombre}>
                  <span>{c.nombre}</span>
                  <div className="track"><div className="fill" style={{ width: `${(c.total / maxCat) * 100}%` }} /></div>
                  <span className="mono">{c.total}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h4>Carga de técnicos</h4>
            <div className="bars">
              {d.carga.map((t: any) => {
                const [n, a] = t.tecnico.split(' ');
                return (
                  <div className="b" key={t.id_tecnico}>
                    <span>{n} {a?.[0]}.</span>
                    <div className="track"><div className="fill" style={{ width: `${(t.activos / t.max_activos) * 100}%` }} /></div>
                    <span className="mono">{t.activos}/{t.max_activos}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card">
            <h4>Precisión del agente IA</h4>
            <div className="small">
              {d.precision?.categoria == null ? (
                'Aún no hay incidentes analizados por el agente.'
              ) : (
                <>Categoría correcta <b>{d.precision.categoria} %</b> · Prioridad sin corrección <b>{d.precision.prioridad} %</b></>
              )}
            </div>
          </div>
        </div>
      </div>

      {d.tecnicos && (
        <div className="card p0">
          <div className="row between" style={{ padding: '14px 14px 0' }}>
            <h4>Resumen por técnico <span className="small muted">({MESES[ahora.getMonth()].toLowerCase()}: resueltos, tiempos y calificación; pendientes al día de hoy)</span></h4>
            <button className="btn ghost" onClick={() => navigate('/tecnicos')}>Ver técnicos →</button>
          </div>
          <TablaDesempeno filas={d.tecnicos} />
        </div>
      )}
    </>
  );
}
