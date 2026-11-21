import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSesion } from '../auth';
import { Cargando, descargarExcel, ErrorBox, Estado, ESTADO_EQUIPO, soloFecha, useCarga } from '../ui';

/** A05 (coordinador) / T03 (técnico, solo lectura) · Historial por ubicación y equipo */
export function Historial() {
  const { puede, usuario } = useSesion();
  const soloLectura = usuario?.rol === 'TECNICO';
  const { datos: cat } = useCarga('/catalogos');
  const [bloque, setBloque] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [equipo, setEquipo] = useState('');
  const [meses, setMeses] = useState('12');
  const [tecnico, setTecnico] = useState('');

  const qs = new URLSearchParams({ meses });
  if (equipo) qs.set('equipo', equipo);
  else if (ubicacion) qs.set('ubicacion', ubicacion);
  else if (bloque) qs.set('bloque', bloque);
  if (tecnico) qs.set('tecnico', tecnico);
  const { datos, error } = useCarga(`/historial?${qs}`);

  const ubicaciones = useMemo(
    () => (cat?.ubicaciones ?? []).filter((u: any) => !bloque || u.bloque === cat.bloques.find((b: any) => String(b.id) === bloque)?.codigo),
    [cat, bloque],
  );
  const equipos = useMemo(() => (cat?.equipos ?? []).filter((e: any) => !ubicacion || String(e.id_ubicacion) === ubicacion), [cat, ubicacion]);

  const exportar = () =>
    descargarExcel(
      'historial.xlsx',
      ['Código', 'Reportado', 'Realizado', 'Problema', 'Equipo', 'Acción realizada', 'Técnico', 'Estado'],
      datos.incidentes.map((i: any) => [
        i.codigo, soloFecha(i.fecha_reporte), i.fecha_resolucion ? soloFecha(i.fecha_resolucion) : '', i.titulo, i.equipo ?? '', i.accion ?? '', i.tecnico ?? '', i.estado_nombre,
      ]),
    );

  return (
    <>
      <div className="row between">
        <h3>Historial de mantenimiento</h3>
        {!soloLectura && puede('reporte.ver') && datos && <button className="btn" onClick={exportar}>⬇ Exportar</button>}
      </div>
      <div className="filters">
        <select id="h-bloque" className="input" aria-label="Bloque" value={bloque} onChange={(e) => { setBloque(e.target.value); setUbicacion(''); setEquipo(''); }}>
          <option value="">Todos los bloques</option>
          {cat?.bloques.map((b: any) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
        </select>
        <select id="h-ubicacion" className="input" aria-label="Ubicación" value={ubicacion} onChange={(e) => { setUbicacion(e.target.value); setEquipo(''); }}>
          <option value="">Todas las ubicaciones</option>
          {ubicaciones.map((u: any) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
        </select>
        <select id="h-equipo" className="input" aria-label="Equipo" value={equipo} onChange={(e) => setEquipo(e.target.value)}>
          <option value="">Equipo: Todos</option>
          {equipos.map((e: any) => <option key={e.id} value={e.id}>{e.codigo}</option>)}
        </select>
        <select id="h-meses" className="input" aria-label="Periodo" value={meses} onChange={(e) => setMeses(e.target.value)}>
          <option value="3">Últimos 3 meses</option>
          <option value="6">Últimos 6 meses</option>
          <option value="12">Últimos 12 meses</option>
          <option value="24">Últimos 24 meses</option>
        </select>
        {/* Coordinador y técnicos pueden filtrar por técnico (incluye los incidentes que se le reasignaron a otro) */}
        <select id="h-tecnico" className="input" aria-label="Técnico" value={tecnico} onChange={(e) => setTecnico(e.target.value)}>
          <option value="">Técnico: Todos</option>
          {cat?.tecnicos.map((t: any) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
      </div>

      {error && <ErrorBox msg={error} />}
      {!datos ? (
        <Cargando />
      ) : (
        <>
          <div className="grid g4">
            <div className="card kpi"><div className="l">Incidentes</div><div className="v">{datos.resumen.total}</div></div>
            <div className="card kpi"><div className="l">Últimos 90 días</div><div className="v">{datos.resumen.ultimos_90}</div></div>
            <div className="card kpi"><div className="l">Solución promedio</div><div className="v">{datos.resumen.horas_promedio != null ? `${datos.resumen.horas_promedio} h` : '—'}</div></div>
            <div className="card kpi"><div className="l">Categoría frecuente</div><div className="v" style={{ fontSize: 18 }}>{datos.resumen.categoria_frecuente ?? '—'}</div></div>
          </div>

          {!soloLectura &&
            datos.alertas.map((a: any) => (
              <div className="notice n-warn" key={a.codigo}>
                ⚠ <b>{a.codigo}</b> {a.fallas90 >= 3 ? `tuvo ${a.fallas90} fallas en 90 días. ` : ''}Se sugiere mantenimiento preventivo
                {a.frecuencia && a.diasDesdeMantenimiento != null ? `: la frecuencia recomendada es cada ${a.frecuencia} días y el último fue hace ${a.diasDesdeMantenimiento} días.` : '.'}
              </div>
            ))}

          <h4>Incidentes <span className="small muted">(primero lo último realizado)</span></h4>
          <div className="card p0 wrap-x">
            <table className="t">
              <thead><tr><th>Código</th><th>Reportado</th><th>Realizado</th><th>Problema</th><th>Equipo</th><th>Acción realizada</th><th>Técnico</th><th>Estado</th></tr></thead>
              <tbody>
                {datos.incidentes.map((i: any) => (
                  <tr key={i.codigo}>
                    <td className="mono">{soloLectura ? i.codigo.slice(-6) : <Link to={`/incidentes/${i.codigo}`}>{i.codigo.slice(-6)}</Link>}</td>
                    <td className="mono small">{soloFecha(i.fecha_reporte)}</td>
                    <td className="mono small">{i.fecha_resolucion ? soloFecha(i.fecha_resolucion) : <span className="muted">—</span>}</td>
                    <td>{i.titulo}</td>
                    <td className="mono small">{i.equipo ?? '—'}</td>
                    <td className="small">{i.accion ?? <span className="muted">—</span>}</td>
                    <td>{i.tecnico ?? '—'}</td>
                    <td><Estado s={i.estado} /></td>
                  </tr>
                ))}
                {datos.incidentes.length === 0 && <tr><td colSpan={8} className="empty">No hay incidentes en este periodo.</td></tr>}
              </tbody>
            </table>
          </div>

          {!soloLectura && <h4>Por equipo</h4>}
          {!soloLectura && (
            <div className="card p0 wrap-x">
              <table className="t">
                <thead><tr><th>Equipo</th><th>Tipo</th><th>Incidentes</th><th>90 días</th><th>Último</th><th>Estado</th></tr></thead>
                <tbody>
                  {datos.equipos.map((e: any) => (
                    <tr key={e.id_equipo}>
                      <td className="mono"><Link to={`/equipos/${e.codigo_inventario}`}>{e.codigo_inventario}</Link></td>
                      <td>{e.tipo}</td>
                      <td>{e.incidentes}</td>
                      <td>{e.ultimos_90}</td>
                      <td className="mono">{soloFecha(e.ultimo)}</td>
                      <td>{e.ultimo_estado && !['RESUELTO', 'CANCELADO'].includes(e.ultimo_estado) ? <Estado s={e.ultimo_estado} /> : <span className={`pill ${ESTADO_EQUIPO[e.estado_equipo]?.clase}`}>{ESTADO_EQUIPO[e.estado_equipo]?.texto}</span>}</td>
                    </tr>
                  ))}
                  {datos.sinEquipo?.incidentes > 0 && (
                    <tr>
                      <td className="muted">Sin equipo</td><td>Tomacorriente / otros</td><td>{datos.sinEquipo.incidentes}</td><td>{datos.sinEquipo.ultimos_90}</td>
                      <td className="mono">{soloFecha(datos.sinEquipo.ultimo)}</td><td />
                    </tr>
                  )}
                  {datos.equipos.length === 0 && !datos.sinEquipo?.incidentes && <tr><td colSpan={6} className="empty">Sin equipos ni incidentes en esta selección.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {soloLectura && <div className="small muted">Vista de consulta, sin opciones para exportar ni editar.</div>}
        </>
      )}
    </>
  );
}
