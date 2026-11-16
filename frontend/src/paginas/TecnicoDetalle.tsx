import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Cargando, descargarExcel, duracion, ErrorBox, Estado, ESTADOS, fechaCorta, Plazo, Prioridad, useIntervalo } from '../ui';

const TURNOS: Record<string, string> = { MATUTINO: 'Matutino', VESPERTINO: 'Vespertino', NOCTURNO: 'Nocturno', COMPLETO: 'Completo' };
export const horasTxt = (h: number | null | undefined) => (h == null ? '—' : `${String(h).replace('.', ',')} h`);
export const Calificacion = ({ v, n }: { v: number | null; n?: number }) =>
  v == null ? <span className="muted">—</span> : <span title={`${n ?? ''} calificaciones`}>★ {String(v).replace('.', ',')}{n != null && <span className="muted small"> ({n})</span>}</span>;
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '—');

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Periodos de los indicadores (desde → hoy). */
export const PERIODOS: Record<string, { texto: string; desde: () => string }> = {
  mes: { texto: 'Este mes', desde: () => { const h = new Date(); return iso(new Date(h.getFullYear(), h.getMonth(), 1)); } },
  '3m': { texto: 'Últimos 3 meses', desde: () => { const h = new Date(); return iso(new Date(h.getFullYear(), h.getMonth() - 2, 1)); } },
  '12m': { texto: 'Últimos 12 meses', desde: () => { const h = new Date(); return iso(new Date(h.getFullYear() - 1, h.getMonth() + 1, 1)); } },
};
export const hoyIso = () => iso(new Date());

/** Tabla de desempeño por técnico (Dashboard y Técnicos). Clic en una fila → detalle del técnico. */
export function TablaDesempeno({ filas }: { filas: any[] }) {
  const navigate = useNavigate();
  return (
    <div className="wrap-x">
      <table className="t">
        <thead>
          <tr>
            <th>Técnico</th><th>Por iniciar</th><th>En proceso</th><th>En verificación</th><th>Fuera de plazo</th>
            <th>Resueltos</th><th>A tiempo</th><th>Tiempo prom.</th><th>Calificación</th><th>Reasignados</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((t) => (
            <tr key={t.id_tecnico} className="click" onClick={() => navigate(`/tecnicos/${t.id_tecnico}`)} title="Ver detalle del técnico">
              <td><b>{t.tecnico}</b>{t.es_lider && <span className="pill n-info" style={{ marginLeft: 6 }}>★ Líder</span>}</td>
              <td className="mono">{t.por_iniciar}</td>
              <td className="mono">{t.en_proceso}</td>
              <td className="mono">{t.en_verificacion}</td>
              <td className="mono" style={{ color: t.fuera_plazo ? 'var(--bad)' : undefined, fontWeight: t.fuera_plazo ? 700 : undefined }}>{t.fuera_plazo}</td>
              <td className="mono">{t.resueltos}</td>
              <td className="mono">{pct(t.a_tiempo, t.resueltos)}</td>
              <td className="mono">{horasTxt(t.horas_promedio)}</td>
              <td><Calificacion v={t.calificacion} n={t.calificaciones} /></td>
              <td className="mono">{t.reasignados}</td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td colSpan={10} className="empty">No hay técnicos activos.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

type Pestana = 'activos' | 'verificacion' | 'resueltos' | 'fuera' | 'reasignados' | 'todos';
const PESTANAS: { id: Pestana; texto: string; filtro: (i: any) => boolean }[] = [
  { id: 'activos', texto: 'Pendientes (por iniciar y en proceso)', filtro: (i) => i.actual && ['ASIGNADO', 'EN_PROCESO'].includes(i.estado) },
  { id: 'verificacion', texto: 'En verificación', filtro: (i) => i.actual && i.estado === 'EN_VERIFICACION' },
  { id: 'resueltos', texto: 'Resueltos', filtro: (i) => i.actual && i.estado === 'RESUELTO' },
  { id: 'fuera', texto: 'Fuera de plazo', filtro: (i) => i.actual && ['ASIGNADO', 'EN_PROCESO'].includes(i.estado) && i.fecha_limite && new Date(i.fecha_limite) < new Date() },
  { id: 'reasignados', texto: 'Reasignados a otro', filtro: (i) => !i.actual },
  { id: 'todos', texto: 'Todos', filtro: () => true },
];

const quien = (i: any) => (i.automatica ? 'Sistema (automática)' : i.asignado_por ?? '—');

/** A08 · Detalle de un técnico: indicadores del periodo y sus incidentes por estado, con fechas y tiempos. */
export function TecnicoDetalle() {
  const { id } = useParams();
  const [periodo, setPeriodo] = useState('mes');
  const [pestana, setPestana] = useState<Pestana>('activos');
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');

  const cargar = useCallback(() => {
    const qs = new URLSearchParams({ desde: PERIODOS[periodo].desde(), hasta: hoyIso() });
    api(`/personal/tecnicos/${id}/detalle?${qs}`).then(setD).catch((e) => setError(e.message));
  }, [id, periodo]);
  useEffect(() => {
    cargar();
  }, [cargar]);
  useIntervalo(cargar, 15000);

  if (error && !d) return <ErrorBox msg={error} />;
  if (!d) return <Cargando />;
  const k = d.indicadores;
  const lista = d.incidentes.filter(PESTANAS.find((p) => p.id === pestana)!.filtro);
  const cuenta = (p: Pestana) => d.incidentes.filter(PESTANAS.find((x) => x.id === p)!.filtro).length;

  const exportar = () =>
    descargarExcel(
      `tecnico_${d.nombres}_${d.apellidos}.xlsx`.replace(/\s+/g, '_'),
      ['Código', 'Incidente', 'Lugar', 'Prioridad', 'Estado', 'Asignado', 'Asignado por', 'Inició', 'Terminó', 'Cerrado', 'Duración', 'Calificación', 'Técnico actual'],
      d.incidentes.map((i: any) => [
        i.codigo, i.titulo, i.lugar ?? '', i.prioridad ?? '', ESTADOS[i.estado], fechaCorta(i.asignado_en), quien(i), fechaCorta(i.fecha_inicio_atencion),
        fechaCorta(i.fecha_resolucion), fechaCorta(i.fecha_cierre),
        i.fecha_resolucion && i.asignado_en ? duracion(new Date(i.fecha_resolucion).getTime() - new Date(i.asignado_en).getTime()) : '',
        i.calificacion ?? '', i.tecnico_actual ?? '',
      ]),
    );

  return (
    <>
      <div className="crumb"><Link to="/tecnicos">Técnicos</Link> / {d.nombres} {d.apellidos}</div>
      <div className="row between">
        <div>
          <h3>
            {d.nombres} {d.apellidos}
            {d.es_lider && <span className="pill n-info" style={{ marginLeft: 8, verticalAlign: 'middle' }}>★ Técnico líder</span>}
          </h3>
          <div className="small muted" style={{ marginTop: 4 }}>
            <span className={`pill ${d.disponible ? 'n-ok' : 'n-warn'}`}>{d.disponible ? 'Disponible' : 'No disponible'}</span>
            {!d.activo && <span className="pill n-bad" style={{ marginLeft: 6 }}>Inactivo</span>}
            {' '}· Turno {TURNOS[d.turno] ?? d.turno} · Cupo {d.max_activos} · Zonas: {d.zonas}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            Especialidades: {d.especialidades.map((e: any, i: number) => <span key={e.nombre}>{i ? ', ' : ''}{e.principal ? <b>{e.nombre}</b> : e.nombre}</span>)}
            {' '}· <span className="mono">{d.telefono_wa}</span> · {d.correo} · Último ingreso al panel: {fechaCorta(d.ultimo_acceso)}
          </div>
        </div>
        <div className="row">
          <select id="td-periodo" className="input" aria-label="Periodo" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {Object.entries(PERIODOS).map(([k2, p]) => <option key={k2} value={k2}>{p.texto}</option>)}
          </select>
          <button className="btn" onClick={exportar}>⬇ Exportar</button>
        </div>
      </div>

      <div className="grid g4">
        <div className="card kpi"><div className="l">Por iniciar</div><div className="v">{k.por_iniciar}</div><div className="d muted">asignados, sin empezar</div></div>
        <div className="card kpi"><div className="l">En proceso</div><div className="v">{k.en_proceso}</div><div className="d muted">{k.por_iniciar + k.en_proceso} de {d.max_activos} de cupo</div></div>
        <div className="card kpi"><div className="l">En verificación</div><div className="v">{k.en_verificacion}</div><div className="d muted">esperan aprobación</div></div>
        <div className="card kpi">
          <div className="l">Fuera de plazo</div>
          <div className="v" style={{ color: k.fuera_plazo ? 'var(--bad)' : undefined }}>{k.fuera_plazo}</div>
          <div className="d muted">pendientes con el tiempo vencido</div>
        </div>
        <div className="card kpi"><div className="l">Resueltos ({PERIODOS[periodo].texto.toLowerCase()})</div><div className="v">{k.resueltos}</div><div className="d muted">{k.reasignados} reasignados a otro técnico</div></div>
        <div className="card kpi"><div className="l">Resueltos a tiempo</div><div className="v">{pct(k.a_tiempo, k.resueltos)}</div><div className="d muted">{k.a_tiempo} de {k.resueltos}</div></div>
        <div className="card kpi"><div className="l">Tiempo promedio de solución</div><div className="v">{horasTxt(k.horas_promedio)}</div><div className="d muted">desde la asignación</div></div>
        <div className="card kpi"><div className="l">Calificación de los reportantes</div><div className="v"><Calificacion v={k.calificacion} /></div><div className="d muted">{k.calificaciones} calificaciones</div></div>
      </div>

      <div className="card p0">
        <div className="tabs" role="tablist" aria-label="Incidentes del técnico">
          {PESTANAS.map((p) => (
            <button key={p.id} role="tab" aria-selected={pestana === p.id} onClick={() => setPestana(p.id)}>
              {p.texto} <span className="muted">({cuenta(p.id)})</span>
            </button>
          ))}
        </div>
        <div className="wrap-x">
          <table className="t">
            <thead>
              <tr>
                <th>Código</th><th>Incidente / lugar</th><th>Prioridad</th><th>Estado</th><th>Asignado</th><th>Inició</th><th>Terminó</th>
                <th>Duración</th><th>Tiempo estimado</th><th>Calificación</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((i: any) => (
                <tr key={i.codigo}>
                  <td className="mono"><Link to={`/incidentes/${i.codigo}`}>{i.codigo.slice(-6)}</Link></td>
                  <td>
                    <b>{i.titulo}</b>
                    <div className="muted small">{i.lugar ?? '—'}{!i.actual && i.tecnico_actual ? ` · ahora lo tiene ${i.tecnico_actual}` : ''}</div>
                  </td>
                  <td><Prioridad p={i.prioridad} /></td>
                  <td><Estado s={i.estado} /></td>
                  <td className="small"><span className="mono">{fechaCorta(i.asignado_en)}</span><div className="muted">por {quien(i)}</div></td>
                  <td className="mono small">{fechaCorta(i.fecha_inicio_atencion)}</td>
                  <td className="mono small">{fechaCorta(i.fecha_resolucion)}</td>
                  <td className="mono small">
                    {i.fecha_resolucion && i.asignado_en ? duracion(new Date(i.fecha_resolucion).getTime() - new Date(i.asignado_en).getTime()) : '—'}
                  </td>
                  <td className="small">{i.actual ? <Plazo inc={i} corto /> : '—'}</td>
                  <td><Calificacion v={i.calificacion} /></td>
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={10} className="empty">No hay incidentes en esta sección.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
