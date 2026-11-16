import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Cargando, descargarExcel, ErrorBox, Estado, ESTADOS, estadoPlazo, fechaCorta, LeyendaPlazo, Plazo, Prioridad, useIntervalo } from '../ui';

const FILTROS = ['estado', 'prioridad', 'categoria', 'bloque', 'tecnico', 'vencido', 'q'] as const;

/** A02 · Bandeja de incidentes */
export function Bandeja() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [cat, setCat] = useState<any>(null);
  const [datos, setDatos] = useState<any>(null);
  const [error, setError] = useState('');
  const pagina = Number(params.get('pagina') ?? 1);

  useEffect(() => {
    api('/catalogos').then(setCat).catch(() => undefined);
  }, []);

  const consultar = () => {
    const qs = new URLSearchParams();
    FILTROS.forEach((f) => params.get(f) && qs.set(f, params.get(f)!));
    qs.set('pagina', String(pagina));
    return api(`/incidentes?${qs}`).then(setDatos).catch((e) => setError(e.message));
  };
  useEffect(() => {
    setDatos(null);
    consultar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, pagina]);
  // Se actualiza sola (los reportes por WhatsApp entran en cualquier momento)
  useIntervalo(() => void consultar(), 10000);

  const filtrar = (clave: string, valor: string) => {
    const p = new URLSearchParams(params);
    if (valor) p.set(clave, valor);
    else p.delete(clave);
    p.delete('pagina');
    setParams(p);
  };

  const irPagina = (n: number) => {
    const p = new URLSearchParams(params);
    p.set('pagina', String(n));
    setParams(p);
  };

  const exportar = () => {
    if (!datos) return;
    const cab = ['Código', 'Incidente', 'Ubicación', 'Categoría', 'Prioridad', 'Puntaje', 'Estado', 'Técnico', 'Reportado', 'Tiempo estimado', 'Plazo'];
    const filas = datos.filas.map((i: any) => [
      i.codigo, i.titulo, i.ubicacion_codigo ?? i.ubicacion_texto, i.categoria, i.prioridad, i.puntaje_prioridad,
      ESTADOS[i.estado], i.tecnico ?? '', fechaCorta(i.fecha_reporte), estadoPlazo(i)?.estimado ?? '', estadoPlazo(i)?.detalle ?? '',
    ]);
    descargarExcel('incidentes.xlsx', cab, filas);
  };

  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1;
  const sel = (id: string, clave: string, placeholder: string, opciones: { v: string; t: string }[]) => (
    <select id={id} className="input" value={params.get(clave) ?? ''} onChange={(e) => filtrar(clave, e.target.value)} aria-label={placeholder}>
      <option value="">{placeholder}</option>
      {opciones.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
    </select>
  );

  return (
    <>
      <div className="row between">
        <h3>Incidentes</h3>
        <div className="row">
          <button className="btn" onClick={exportar}>⬇ Exportar</button>
          <button className="btn pri" onClick={() => navigate('/incidentes/nuevo')}>+ Registrar incidente</button>
        </div>
      </div>
      <div className="filters">
        {sel('f-estado', 'estado', 'Estado: Todos', Object.entries(ESTADOS).map(([v, t]) => ({ v, t })))}
        {sel('f-prioridad', 'prioridad', 'Prioridad: Todas', (cat?.prioridades ?? []).map((p: any) => ({ v: p.codigo, t: p.nombre })))}
        {sel('f-categoria', 'categoria', 'Categoría: Todas', (cat?.categorias ?? []).map((c: any) => ({ v: c.codigo, t: c.nombre })))}
        {sel('f-bloque', 'bloque', 'Bloque: Todos', (cat?.bloques ?? []).map((b: any) => ({ v: b.codigo, t: b.nombre })))}
        {sel('f-tecnico', 'tecnico', 'Técnico: Todos', (cat?.tecnicos ?? []).map((t: any) => ({ v: String(t.id), t: t.nombre })))}
        <label className="check input" style={{ width: 'auto' }}>
          <input id="f-vencido" type="checkbox" checked={!!params.get('vencido')} onChange={(e) => filtrar('vencido', e.target.checked ? '1' : '')} />
          Solo fuera de plazo
        </label>
        {params.get('q') && (
          <button className="btn ghost" onClick={() => filtrar('q', '')}>Búsqueda: “{params.get('q')}” ✕</button>
        )}
      </div>
      {error && <ErrorBox msg={error} />}
      <LeyendaPlazo />
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {!datos ? (
          <Cargando />
        ) : datos.filas.length === 0 ? (
          <div className="empty">No hay incidentes con esos filtros.</div>
        ) : (
          <table className="t">
            <thead>
              <tr><th>Código</th><th>Incidente / ubicación</th><th>Categoría</th><th>Prioridad</th><th>Estado</th><th>Técnico</th><th>Reportado</th><th>Tiempo estimado</th></tr>
            </thead>
            <tbody>
              {datos.filas.map((i: any) => (
                <tr key={i.id_incidente} className="click" onClick={() => navigate(`/incidentes/${i.codigo}`)}>
                  <td className="mono">{i.codigo}</td>
                  <td>
                    <b>{i.titulo}</b>
                    <div className="muted small">{i.ubicacion_codigo ? `${i.ubicacion_codigo} · ${i.ubicacion}` : `“${i.ubicacion_texto}”`}</div>
                    {i.revision_manual && <span className="pill n-warn" style={{ marginTop: 3 }}>Revisión manual</span>}
                  </td>
                  <td>{i.categoria ?? '—'}</td>
                  <td><Prioridad p={i.prioridad} /> <span className="mono small muted">{i.puntaje_prioridad ?? ''}</span></td>
                  <td><Estado s={i.estado} /></td>
                  <td>{i.tecnico ?? '—'}</td>
                  <td className="mono small">{fechaCorta(i.fecha_reporte)}</td>
                  <td className="small"><Plazo inc={i} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {datos && (
        <div className="row between small muted">
          <span>Mostrando {datos.filas.length} de {datos.total} · página {pagina} de {totalPaginas}</span>
          <div className="row">
            <button className="btn" disabled={pagina <= 1} onClick={() => irPagina(pagina - 1)}>← Anterior</button>
            <button className="btn" disabled={pagina >= totalPaginas} onClick={() => irPagina(pagina + 1)}>Siguiente →</button>
          </div>
        </div>
      )}
    </>
  );
}
