import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Campo, Cargando, Dialogo, ErrorBox, Interruptor, useAccion, useCarga } from '../ui';

type Formulario = { tipo: 'sede' | 'bloque' | 'ubicacion'; datos: any } | null;

/** A06 · Ubicaciones: sede → bloque → ubicación */
export function Ubicaciones() {
  const { datos, error, recargar } = useCarga('/infraestructura/ubicaciones');
  const { ejecutar, Aviso, ocupado } = useAccion();
  const [bloque, setBloque] = useState<number | null>(null);
  const [form, setForm] = useState<Formulario>(null);

  if (error) return <ErrorBox msg={error} />;
  if (!datos) return <Cargando />;

  const bloqueSel = bloque ?? datos.bloques[0]?.id_bloque ?? null;
  const filas = datos.ubicaciones.filter((u: any) => u.id_bloque === bloqueSel);
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
      <div className="grid g-aside">
        <div className="card stack-sm">
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
      </div>
      <div className="small muted">Una ubicación con incidentes no se elimina: se desactiva para conservar su historial.</div>

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
