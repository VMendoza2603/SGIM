import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Cargando, descargarExcel, ErrorBox, soloFecha, useCarga, useIntervalo } from '../ui';

/** Formato de cada valor: número, porcentaje, horas, calificación (★) o fecha. */
type Formato = 'num' | 'pct' | 'h' | 'star' | 'fecha' | 'texto';
type Columna = { k: string; t: string; f?: Formato };
type Tarjeta = { k: string; t: string; f?: Formato; sub?: (r: any) => string };
interface Config {
  icono: string;
  desc: string;
  columnas: Columna[];
  tarjetas: Tarjeta[];
  grafico: { titulo: string; etiqueta: string; valor: string; f?: Formato; max?: number };
  enlace?: (fila: any) => string;
}

const coma = (v: number) => String(v).replace('.', ',');
function formato(v: any, f: Formato = 'num') {
  if (v == null || v === '') return '—';
  if (f === 'pct') return `${v} %`;
  if (f === 'h') return `${coma(v)} h`;
  if (f === 'star') return `★ ${coma(v)}`;
  if (f === 'fecha') return soloFecha(v);
  return typeof v === 'number' ? coma(v) : String(v);
}

/** Qué muestra cada reporte (los datos vienen de GET /reportes/:id). */
const CONFIG: Record<string, Config> = {
  'categoria-prioridad': {
    icono: '🏷️',
    desc: 'Cuántos incidentes hubo de cada tipo y con qué prioridad',
    columnas: [
      { k: 'categoria', t: 'Categoría', f: 'texto' }, { k: 'alta', t: 'Alta' }, { k: 'media', t: 'Media' }, { k: 'baja', t: 'Baja' },
      { k: 'cerrados', t: 'Cerrados' }, { k: 'total', t: 'Total' },
    ],
    tarjetas: [
      { k: 'total', t: 'Incidentes reportados' },
      { k: 'alta', t: 'De prioridad alta', sub: (r) => (r.total ? `${Math.round((100 * r.alta) / r.total)} % del total` : '') },
      { k: 'abiertos', t: 'Todavía abiertos' },
      { k: 'categoria_frecuente', t: 'Categoría más frecuente', f: 'texto' },
    ],
    grafico: { titulo: 'Incidentes por categoría', etiqueta: 'categoria', valor: 'total' },
  },
  sla: {
    icono: '⏱️',
    desc: 'Porcentaje atendido dentro del tiempo estimado, por prioridad',
    columnas: [
      { k: 'prioridad', t: 'Prioridad', f: 'texto' }, { k: 'plazo_horas', t: 'Tiempo estimado', f: 'h' }, { k: 'incidentes', t: 'Incidentes' },
      { k: 'a_tiempo', t: 'A tiempo' }, { k: 'fuera_plazo', t: 'Fuera de plazo' }, { k: 'porcentaje', t: 'Cumplimiento', f: 'pct' },
    ],
    tarjetas: [
      { k: 'porcentaje', t: 'Cumplimiento global', f: 'pct' },
      { k: 'incidentes', t: 'Incidentes del periodo' },
      { k: 'fuera_plazo', t: 'Fuera de plazo' },
      { k: 'horas_promedio', t: 'Tiempo medio de solución', f: 'h' },
    ],
    grafico: { titulo: 'Cumplimiento por prioridad', etiqueta: 'prioridad', valor: 'porcentaje', f: 'pct', max: 100 },
  },
  tecnicos: {
    icono: '👷',
    desc: 'Resueltos, a tiempo, reasignados, tiempo medio y calificación de cada técnico',
    columnas: [
      { k: 'tecnico', t: 'Técnico', f: 'texto' }, { k: 'activos', t: 'Pendientes' }, { k: 'resueltos', t: 'Resueltos' }, { k: 'a_tiempo', t: 'A tiempo' },
      { k: 'fuera_plazo', t: 'Fuera de plazo' }, { k: 'reasignados', t: 'Reasignados' }, { k: 'horas_promedio', t: 'Tiempo prom.', f: 'h' },
      { k: 'calificacion', t: 'Calificación', f: 'star' }, { k: 'calificaciones', t: 'N.º calificaciones' },
    ],
    tarjetas: [
      { k: 'resueltos', t: 'Incidentes resueltos' },
      { k: 'porcentaje_a_tiempo', t: 'Resueltos a tiempo', f: 'pct' },
      { k: 'calificacion', t: 'Calificación promedio', f: 'star', sub: (r) => `${r.calificaciones} calificaciones` },
      { k: 'tecnicos', t: 'Técnicos activos' },
    ],
    grafico: { titulo: 'Resueltos por técnico', etiqueta: 'tecnico', valor: 'resueltos' },
    enlace: (f) => `/tecnicos/${f.id_tecnico}`,
  },
  ubicaciones: {
    icono: '📍',
    desc: 'Los 10 lugares con más fallas, para planificar mantenimiento preventivo',
    columnas: [
      { k: 'codigo', t: 'Código', f: 'texto' }, { k: 'ubicacion', t: 'Ubicación', f: 'texto' }, { k: 'incidentes', t: 'Incidentes' },
      { k: 'abiertos', t: 'Abiertos' }, { k: 'ultimo', t: 'Último', f: 'fecha' }, { k: 'categoria_frecuente', t: 'Categoría frecuente', f: 'texto' },
    ],
    tarjetas: [
      { k: 'incidentes', t: 'Incidentes del periodo' },
      { k: 'ubicaciones', t: 'Lugares con fallas' },
      { k: 'sin_ubicacion', t: 'Sin lugar reconocido' },
    ],
    grafico: { titulo: 'Incidentes por lugar', etiqueta: 'codigo', valor: 'incidentes' },
  },
  ia: {
    icono: '🤖',
    desc: 'Cuántas veces el coordinador tuvo que corregir la categoría o la prioridad',
    columnas: [
      { k: 'categoria', t: 'Categoría', f: 'texto' }, { k: 'analizados', t: 'Analizados' }, { k: 'categoria_correcta', t: 'Categoría correcta' },
      { k: 'pct_categoria', t: '% acierto', f: 'pct' }, { k: 'prioridad_sin_correccion', t: 'Prioridad sin corrección' },
    ],
    tarjetas: [
      { k: 'analizados', t: 'Reportes analizados' },
      { k: 'pct_categoria', t: 'Categoría correcta', f: 'pct' },
      { k: 'pct_prioridad', t: 'Prioridad sin corrección', f: 'pct' },
      { k: 'confianza_media', t: 'Confianza media de la IA', f: 'pct' },
    ],
    grafico: { titulo: 'Acierto de categoría', etiqueta: 'categoria', valor: 'pct_categoria', f: 'pct', max: 100 },
  },
  satisfaccion: {
    icono: '⭐',
    desc: 'Calificación que dan los reportantes por WhatsApp al cerrar el incidente',
    columnas: [
      { k: 'categoria', t: 'Categoría', f: 'texto' }, { k: 'calificaciones', t: 'Calificaciones' }, { k: 'promedio', t: 'Promedio', f: 'star' },
      { k: 'satisfechos', t: 'Satisfechos (4–5)' }, { k: 'insatisfechos', t: 'Insatisfechos (1–2)' },
    ],
    tarjetas: [
      { k: 'promedio', t: 'Calificación promedio', f: 'star' },
      { k: 'calificaciones', t: 'Calificaciones recibidas' },
      { k: 'pct_satisfechos', t: 'Satisfechos', f: 'pct' },
      { k: 'sin_calificar', t: 'Resueltos sin calificar' },
    ],
    grafico: { titulo: 'Promedio por categoría', etiqueta: 'categoria', valor: 'promedio', f: 'star', max: 5 },
  },
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const RAPIDOS: Record<string, () => [string, string]> = {
  'Este mes': () => { const h = new Date(); return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(h)]; },
  'Mes anterior': () => { const h = new Date(); return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth(), 0))]; },
  'Últimos 3 meses': () => { const h = new Date(); return [iso(new Date(h.getFullYear(), h.getMonth() - 2, 1)), iso(h)]; },
  'Este año': () => { const h = new Date(); return [iso(new Date(h.getFullYear(), 0, 1)), iso(h)]; },
};

/** Gráfico de barras horizontal (mismo estilo que el Dashboard). */
function Barras({ filas, g }: { filas: any[]; g: Config['grafico'] }) {
  const max = g.max ?? Math.max(1, ...filas.map((f) => Number(f[g.valor]) || 0));
  return (
    <div className="bars">
      {filas.map((f, i) => (
        <div className="b" key={i}>
          <span title={String(f[g.etiqueta])}>{f[g.etiqueta]}</span>
          <div className="track"><div className="fill" style={{ width: `${Math.min(100, ((Number(f[g.valor]) || 0) / max) * 100)}%` }} /></div>
          <span className="mono">{formato(f[g.valor], g.f)}</span>
        </div>
      ))}
    </div>
  );
}

/** A12 · Reportes de gestión (no incluye costos: fuera del alcance aprobado). Se actualizan solos cada 15 s. */
export function Reportes() {
  const navigate = useNavigate();
  const { datos: lista, error } = useCarga<any[]>('/reportes');
  const [desde, setDesde] = useState(() => RAPIDOS['Este mes']()[0]);
  const [hasta, setHasta] = useState(() => RAPIDOS['Este mes']()[1]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [reporte, setReporte] = useState<any>(null);
  const [err, setErr] = useState('');

  const cargar = useCallback(() => {
    if (!abierto) return;
    api(`/reportes/${abierto}?${new URLSearchParams({ desde, hasta })}`)
      .then((r) => {
        setReporte({ id: abierto, ...r });
        setErr('');
      })
      .catch((e) => setErr(e.message));
  }, [abierto, desde, hasta]);
  useEffect(() => {
    cargar();
  }, [cargar]);
  useIntervalo(cargar, 15000);

  if (error) return <ErrorBox msg={error} />;
  if (!lista) return <Cargando />;
  const cfg = reporte ? CONFIG[reporte.id] : null;

  const exportar = () =>
    descargarExcel(
      `${reporte.id}_${desde}_${hasta}.xlsx`,
      cfg!.columnas.map((c) => c.t),
      reporte.filas.map((f: any) => cfg!.columnas.map((c) => (c.f === 'fecha' ? soloFecha(f[c.k]) : f[c.k] ?? ''))),
    );

  return (
    <>
      <div className="row between">
        <h3>Reportes</h3>
        <span className="small muted">Se actualizan solos cada 15 s</span>
      </div>
      <div className="filters no-print">
        <label className="check" htmlFor="rp-desde">Desde <input id="rp-desde" className="input" type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="check" htmlFor="rp-hasta">Hasta <input id="rp-hasta" className="input" type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} /></label>
        {Object.entries(RAPIDOS).map(([t, fn]) => (
          <button key={t} className="btn ghost" onClick={() => { const [a, b] = fn(); setDesde(a); setHasta(b); }}>{t}</button>
        ))}
      </div>

      {!abierto ? (
        <div className="grid g3">
          {lista.map((r) => (
            <button key={r.id} className="card stack-sm" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => { setReporte(null); setAbierto(r.id); }}>
              <h4><span aria-hidden="true">{CONFIG[r.id]?.icono} </span>{r.titulo}</h4>
              <div className="small muted">{CONFIG[r.id]?.desc}</div>
              <div className="small" style={{ color: 'var(--accent)' }}>Ver reporte →</div>
            </button>
          ))}
        </div>
      ) : !reporte || !cfg ? (
        <Cargando />
      ) : (
        <div className="stack">
          <div className="row between">
            <div>
              <h4 style={{ fontSize: 16 }}>{cfg.icono} {reporte.titulo}</h4>
              <div className="small muted">Del {soloFecha(reporte.desde)} al {soloFecha(reporte.hasta)} · {cfg.desc}</div>
            </div>
            <div className="row no-print">
              <button className="btn ghost" onClick={() => { setAbierto(null); setReporte(null); }}>← Todos los reportes</button>
              <button className="btn" onClick={() => window.print()}>PDF</button>
              <button className="btn" disabled={!reporte.filas.length} onClick={exportar}>Excel</button>
            </div>
          </div>

          {reporte.resumen && (
            <div className="grid g4">
              {cfg.tarjetas.map((t) => (
                <div className="card kpi" key={t.k}>
                  <div className="l">{t.t}</div>
                  <div className="v" style={t.f === 'texto' ? { fontSize: 18 } : undefined}>{formato(reporte.resumen[t.k], t.f)}</div>
                  {t.sub && <div className="d muted">{t.sub(reporte.resumen)}</div>}
                </div>
              ))}
            </div>
          )}

          {reporte.filas.length === 0 ? (
            <div className="card"><div className="empty">No hay datos en ese periodo.</div></div>
          ) : (
            <div className="grid g-main">
              <div className="card p0 wrap-x">
                <table className="t">
                  <thead><tr>{cfg.columnas.map((c) => <th key={c.k}>{c.t}</th>)}</tr></thead>
                  <tbody>
                    {reporte.filas.map((f: any, i: number) => (
                      <tr key={i} className={cfg.enlace ? 'click' : undefined} onClick={cfg.enlace ? () => navigate(cfg.enlace!(f)) : undefined}>
                        {cfg.columnas.map((c) => (
                          <td key={c.k} className={c.f && c.f !== 'texto' ? 'mono' : ''}>{c.f === 'texto' && c === cfg.columnas[0] ? <b>{f[c.k]}</b> : formato(f[c.k], c.f ?? 'num')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card">
                <h4>{cfg.grafico.titulo}</h4>
                <Barras filas={reporte.filas} g={cfg.grafico} />
              </div>
            </div>
          )}
          {cfg.enlace && <div className="small muted no-print">Haz clic en un técnico para ver su detalle.</div>}
        </div>
      )}
      {err && <ErrorBox msg={err} />}
    </>
  );
}
