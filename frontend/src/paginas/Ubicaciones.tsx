import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { MapaCampus } from './MapaCampus';
import { Campo, Cargando, Dialogo, ErrorBox, fechaCorta, Interruptor, useAccion, useCarga } from '../ui';

type Formulario = { tipo: 'sede' | 'bloque' | 'ubicacion'; datos: any } | null;

const PERIODOS = [
  { dias: 30, texto: 'Últimos 30 días' },
  { dias: 90, texto: 'Últimos 90 días' },
  { dias: 365, texto: 'Último año' },
];

/** Qué curso o espacio tiene más problemas (ranking de incidentes por lugar, sin los cancelados). */
function LugaresConMasProblemas() {
  const [dias, setDias] = useState(90);
  const { datos, error } = useCarga<{ filas: any[]; sin_lugar: number }>(`/infraestructura/ubicaciones/ranking?dias=${dias}`);
  const max = Math.max(1, ...(datos?.filas ?? []).map((f) => f.total));
  const primero = datos?.filas[0];
  return (
    <div className="card stack">
      <div className="row between">
        <div>
          <h4>Lugares con más problemas</h4>
          <div className="small muted">Cursos y espacios con más incidentes reportados, para priorizar el mantenimiento preventivo.</div>
        </div>
        <select id="rk-periodo" className="input" style={{ width: 'auto' }} aria-label="Periodo" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
          {PERIODOS.map((p) => <option key={p.dias} value={p.dias}>{p.texto}</option>)}
        </select>
      </div>
      {error ? (
        <ErrorBox msg={error} />
      ) : !datos ? (
        <Cargando />
      ) : datos.filas.length === 0 ? (
        <div className="empty">No hay incidentes con lugar registrado en este periodo.</div>
      ) : (
        <>
          <div className="notice">
            El lugar con más problemas es <b>{primero.codigo} · {primero.nombre}</b> ({primero.bloque}): {primero.total}{' '}
            {primero.total === 1 ? 'incidente' : 'incidentes'}
            {primero.categoria_frecuente ? `, sobre todo de ${primero.categoria_frecuente.toLowerCase()}` : ''}
            {primero.activos ? ` · ${primero.activos} sin resolver` : ''}.
          </div>
          <div className="wrap-x">
            <table className="t">
              <thead>
                <tr><th>#</th><th>Lugar</th><th>Bloque</th><th style={{ minWidth: 160 }}>Incidentes</th><th>Sin resolver</th><th>Prioridad alta</th><th>Tipo más frecuente</th><th>Último reporte</th></tr>
              </thead>
              <tbody>
                {datos.filas.map((f, i) => (
                  <tr key={f.id_ubicacion}>
                    <td className="mono">{i + 1}</td>
                    <td><b>{f.codigo}</b> · {f.nombre}<div className="small muted">{f.tipo}</div></td>
                    <td>{f.bloque}</td>
                    <td>
                      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'nowrap' }}>
                        <div className="barra" style={{ flex: 1, minWidth: 60 }} aria-hidden="true"><div className="fill" style={{ width: `${(f.total / max) * 100}%` }} /></div>
                        <span className="mono">{f.total}</span>
                      </div>
                    </td>
                    <td className="mono">{f.activos}</td>
                    <td className="mono">{f.altas}</td>
                    <td>{f.categoria_frecuente ?? '—'}</td>
                    <td className="small">{fechaCorta(f.ultimo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {datos.sin_lugar > 0 && (
            <div className="small muted">
              Además hay {datos.sin_lugar} {datos.sin_lugar === 1 ? 'incidente' : 'incidentes'} con un lugar que el sistema no reconoció (en revisión manual); no se cuentan aquí.
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A06 · Ubicaciones: sede → bloque → ubicación */
export function Ubicaciones() {
  const { datos, error, recargar } = useCarga('/infraestructura/ubicaciones');
  const { ejecutar, Aviso, ocupado } = useAccion();
  const [bloque, setBloque] = useState<number | null>(null);
  const [form, setForm] = useState<Formulario>(null);

  if (error) return <ErrorBox msg={error} />;
  if (!datos) return <Cargando />;

  const bloqueSel = bloque ?? datos.bloques[0]?.id_bloque ?? null;
  // Ordenadas por piso y código (con muchos espacios por bloque se leen piso por piso)
  const filas = datos.ubicaciones.filter((u: any) => u.id_bloque === bloqueSel).sort((a: any, b: any) => a.piso - b.piso || a.codigo.localeCompare(b.codigo, "es", { numeric: true }));
  const bloqueActual = datos.bloques.find((b: any) => b.id_bloque === bloqueSel);
  const set = (campo: string, valor: unknown) => setForm((f) => f && { ...f, datos: { ...f.datos, [campo]: valor } });

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const d = form.datos;
    const ok = await ejecutar(async () => {
      if (form.tipo === 'sede') await api('/infraestructura/sedes', { method: 'POST', body: { nombre: d.nombre, direccion: d.direccion || null } });
      if (form.tipo === 'bloque') {
        await api('/infraestructura/bloques', { method: 'POST', body: { id_sede: Number(d.id_sede), codigo: d.codigo, nombre: d.nombre, pisos: Number(d.pisos) } });
      }
      if (form.tipo === 'ubicacion') {
        const body = {
          id_bloque: Number(d.id_bloque), id_tipo_ubicacion: Number(d.id_tipo_ubicacion), codigo: d.codigo, nombre: d.nombre,
          piso: Number(d.piso), capacidad: d.capacidad === '' || d.capacidad == null ? null : Number(d.capacidad), activo: d.activo ?? true,
        };
        if (d.id_ubicacion) await api(`/infraestructura/ubicaciones/${d.id_ubicacion}`, { method: 'PUT', body });
        else await api('/infraestructura/ubicaciones', { method: 'POST', body });
      }
    }, 'Cambios guardados.');
    if (ok) {
      setForm(null);
      recargar();
    }
  };

  const cambiarActivo = (u: any, activo: boolean) =>
    ejecutar(() => api(`/infraestructura/ubicaciones/${u.id_ubicacion}/activo`, { method: 'PATCH', body: { activo } }), activo ? `${u.codigo} activada.` : `${u.codigo} desactivada.`).then(recargar);

  return (
    <>
      <div className="row between">
        <h3>Ubicaciones</h3>
        <button className="btn pri" disabled={!bloqueSel} onClick={() => setForm({ tipo: 'ubicacion', datos: { id_bloque: bloqueSel, id_tipo_ubicacion: datos.tipos[0]?.id, piso: 1, activo: true } })}>
          + Nueva ubicación
        </button>
      </div>
      <Aviso />
      {/* Estructura · tabla del bloque · mapa del campus UNEMI */}
      <div className="ubic-layout">
        <div className="card stack-sm ubic-estructura">
          <h4>Estructura</h4>
          <div className="tree">
            {datos.sedes.map((s: any) => (
              <div key={s.id_sede}>
                <div style={{ padding: '4px 8px' }}>🏫 {s.nombre}</div>
                {datos.bloques.filter((b: any) => b.id_sede === s.id_sede).map((b: any) => (
                  <div key={b.id_bloque}>
                    <button className={`n1 ${b.id_bloque === bloqueSel ? 'on' : ''}`} onClick={() => setBloque(b.id_bloque)} aria-pressed={b.id_bloque === bloqueSel}>
                      {b.id_bloque === bloqueSel ? '▾' : '▸'} {b.nombre}
                    </button>
                    {b.id_bloque === bloqueSel &&
                      datos.ubicaciones.filter((u: any) => u.id_bloque === b.id_bloque).map((u: any) => (
                        <div key={u.id_ubicacion} className="n2 muted" style={{ padding: '2px 8px 2px 40px' }}>{u.codigo} · {u.nombre}</div>
                      ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="row">
            <button className="btn" onClick={() => setForm({ tipo: 'sede', datos: {} })}>+ Sede</button>
            <button className="btn" disabled={!datos.sedes.length} onClick={() => setForm({ tipo: 'bloque', datos: { id_sede: datos.sedes[0]?.id_sede, pisos: 1 } })}>+ Bloque</button>
          </div>
        </div>
        <div className="stack-sm ubic-tabla">
          {bloqueActual && (
            <div className="row between">
              <h4>{bloqueActual.nombre}</h4>
              <span className="small muted">
                {bloqueActual.pisos} {bloqueActual.pisos === 1 ? 'piso' : 'pisos'} · {filas.length} {filas.length === 1 ? 'ubicación' : 'ubicaciones'}
              </span>
            </div>
          )}
          <div className="card p0 wrap-x">
            <table className="t">
              <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Piso</th><th>Equipos</th><th>QR</th><th>Activo</th><th /></tr></thead>
              <tbody>
                {filas.map((u: any) => (
                  <tr key={u.id_ubicacion} style={{ opacity: u.activo ? 1 : 0.55 }}>
                    <td className="mono">{u.codigo}</td>
                    <td>{u.nombre}</td>
                    <td>{u.tipo}</td>
                    <td>{u.piso}</td>
                    <td>{u.equipos}</td>
                    <td className="mono">{u.codigo_qr ?? '—'}</td>
                    <td><Interruptor activo={u.activo} etiqueta={u.activo ? 'Desactivar ubicación' : 'Activar ubicación'} onCambio={(v) => cambiarActivo(u, v)} /></td>
                    <td><button className="btn ghost" onClick={() => setForm({ tipo: 'ubicacion', datos: { ...u } })}>Editar</button></td>
                  </tr>
                ))}
                {filas.length === 0 && <tr><td colSpan={8} className="empty">Este bloque aún no tiene ubicaciones.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="small muted">Una ubicación con incidentes no se elimina: se desactiva para conservar su historial.</div>
        </div>
        <MapaCampus seleccionado={bloqueSel} onElegir={(id) => setBloque(id)} />
        <div className="ubic-lugares">
          <LugaresConMasProblemas />
        </div>
      </div>

      {form && (
        <Dialogo
          titulo={form.tipo === 'sede' ? 'Nueva sede' : form.tipo === 'bloque' ? 'Nuevo bloque' : form.datos.id_ubicacion ? `Editar ${form.datos.codigo}` : 'Nueva ubicación'}
          onCerrar={() => setForm(null)}
        >
          <form className="stack" onSubmit={guardar}>
            {form.tipo === 'sede' && (
              <>
                <Campo id="f-nombre" etiqueta="Nombre"><input id="f-nombre" className="input" required value={form.datos.nombre ?? ''} onChange={(e) => set('nombre', e.target.value)} /></Campo>
                <Campo id="f-dir" etiqueta="Dirección"><input id="f-dir" className="input" value={form.datos.direccion ?? ''} onChange={(e) => set('direccion', e.target.value)} /></Campo>
              </>
            )}
            {form.tipo === 'bloque' && (
              <div className="form-grid">
                <Campo id="f-sede" etiqueta="Sede" className="full">
                  <select id="f-sede" className="input" value={form.datos.id_sede} onChange={(e) => set('id_sede', e.target.value)}>
                    {datos.sedes.map((s: any) => <option key={s.id_sede} value={s.id_sede}>{s.nombre}</option>)}
                  </select>
                </Campo>
                <Campo id="f-cod" etiqueta="Código"><input id="f-cod" className="input" required maxLength={20} value={form.datos.codigo ?? ''} onChange={(e) => set('codigo', e.target.value)} /></Campo>
                <Campo id="f-pisos" etiqueta="Pisos"><input id="f-pisos" className="input" type="number" min={1} value={form.datos.pisos} onChange={(e) => set('pisos', e.target.value)} /></Campo>
                <Campo id="f-nom" etiqueta="Nombre" className="full"><input id="f-nom" className="input" required value={form.datos.nombre ?? ''} onChange={(e) => set('nombre', e.target.value)} /></Campo>
              </div>
            )}
            {form.tipo === 'ubicacion' && (
              <div className="form-grid">
                <Campo id="f-bloque" etiqueta="Bloque">
                  <select id="f-bloque" className="input" value={form.datos.id_bloque} onChange={(e) => set('id_bloque', e.target.value)}>
                    {datos.bloques.map((b: any) => <option key={b.id_bloque} value={b.id_bloque}>{b.nombre}</option>)}
                  </select>
                </Campo>
                <Campo id="f-tipo" etiqueta="Tipo">
                  <select id="f-tipo" className="input" value={form.datos.id_tipo_ubicacion} onChange={(e) => set('id_tipo_ubicacion', e.target.value)}>
                    {datos.tipos.map((t: any) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                </Campo>
                <Campo id="f-ucod" etiqueta="Código" ayuda="Ej.: B-204"><input id="f-ucod" className="input" required value={form.datos.codigo ?? ''} onChange={(e) => set('codigo', e.target.value)} /></Campo>
                <Campo id="f-piso" etiqueta="Piso"><input id="f-piso" className="input" type="number" min={0} value={form.datos.piso} onChange={(e) => set('piso', e.target.value)} /></Campo>
                <Campo id="f-unom" etiqueta="Nombre" className="full"><input id="f-unom" className="input" required value={form.datos.nombre ?? ''} onChange={(e) => set('nombre', e.target.value)} /></Campo>
                <Campo id="f-cap" etiqueta="Capacidad"><input id="f-cap" className="input" type="number" min={0} value={form.datos.capacidad ?? ''} onChange={(e) => set('capacidad', e.target.value)} /></Campo>
              </div>
            )}
            <div className="row end">
              <button type="button" className="btn" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn pri" disabled={ocupado}>Guardar</button>
            </div>
          </form>
        </Dialogo>
      )}
    </>
  );
}
