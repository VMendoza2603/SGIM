import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Campo, Cargando, Dialogo, ErrorBox, Interruptor, Prioridad, useAccion, useCarga } from '../ui';

const OPERADORES = ['=', '!=', '>', '>=', '<', '<=', 'IN', 'CONTAINS'];

function FormRegla({ inicial, datos, onCerrar, onGuardado }: { inicial: any; datos: any; onCerrar: () => void; onGuardado: () => void }) {
  const { datos: cat } = useCarga('/catalogos');
  const { ejecutar, Aviso, ocupado } = useAccion();
  const [d, setD] = useState<any>(inicial);
  const set = (k: string, v: unknown) => setD({ ...d, [k]: v });
  const variable = datos.variables.find((v: any) => v.codigo === d.variable);

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      nombre: d.nombre, descripcion: d.descripcion || null, variable: d.variable, operador: d.operador, valor: String(d.valor),
      puntos: Number(d.puntos), forzar_prioridad: d.forzar_prioridad ? Number(d.forzar_prioridad) : null, orden: Number(d.orden), activo: d.activo ?? true,
    };
    const ok = await ejecutar(() => (d.id_regla ? api(`/reglas/${d.id_regla}`, { method: 'PUT', body }) : api('/reglas', { method: 'POST', body })));
    if (ok) onGuardado();
  };

  return (
    <Dialogo titulo={d.id_regla ? 'Editar regla' : 'Nueva regla'} onCerrar={onCerrar}>
      <form className="stack" onSubmit={guardar}>
        <div className="form-grid">
          <Campo id="rg-nombre" etiqueta="Nombre" className="full"><input id="rg-nombre" className="input" required value={d.nombre ?? ''} onChange={(e) => set('nombre', e.target.value)} /></Campo>
          <Campo id="rg-var" etiqueta="Variable">
            <select id="rg-var" className="input" value={d.variable} onChange={(e) => {
              const v = datos.variables.find((x: any) => x.codigo === e.target.value);
              setD({ ...d, variable: e.target.value, operador: '=', valor: v?.tipo === 'bool' ? 'true' : '' });
            }}>
              {datos.variables.map((v: any) => <option key={v.codigo} value={v.codigo}>{v.nombre}</option>)}
            </select>
          </Campo>
          <Campo id="rg-op" etiqueta="Operador">
            <select id="rg-op" className="input" value={d.operador} onChange={(e) => set('operador', e.target.value)} disabled={variable?.tipo === 'bool'}>
              {OPERADORES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Campo>
          <Campo id="rg-valor" etiqueta="Valor">
            {variable?.tipo === 'bool' ? (
              <select id="rg-valor" className="input" value={d.valor} onChange={(e) => set('valor', e.target.value)}>
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            ) : variable?.tipo === 'categoria' ? (
              <select id="rg-valor" className="input" value={d.valor} onChange={(e) => set('valor', e.target.value)}>
                <option value="">Elige…</option>
                {cat?.categorias.map((c: any) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
              </select>
            ) : (
              <input id="rg-valor" className="input" type="number" required value={d.valor ?? ''} onChange={(e) => set('valor', e.target.value)} />
            )}
          </Campo>
          <Campo id="rg-puntos" etiqueta="Puntos"><input id="rg-puntos" className="input" type="number" min={-100} max={200} required value={d.puntos ?? ''} onChange={(e) => set('puntos', e.target.value)} /></Campo>
          <Campo id="rg-fuerza" etiqueta="Escala directamente a">
            <select id="rg-fuerza" className="input" value={d.forzar_prioridad ?? ''} onChange={(e) => set('forzar_prioridad', e.target.value)}>
              <option value="">No escala</option>
              {datos.prioridades.map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo id="rg-orden" etiqueta="Orden"><input id="rg-orden" className="input" type="number" min={0} max={999} value={d.orden ?? 100} onChange={(e) => set('orden', e.target.value)} /></Campo>
        </div>
        <Aviso />
        <div className="row end">
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn pri" disabled={ocupado || d.valor === ''}>Guardar</button>
        </div>
      </form>
    </Dialogo>
  );
}

/** Probador del motor de reglas (no guarda nada). */
function Simulador({ variables }: { variables: any[] }) {
  const { datos: cat } = useCarga('/catalogos');
  const [vars, setVars] = useState<any>({ categoria: 'AGUA', fuga_activa: true, afecta_clases: true });
  const [res, setRes] = useState<any>(null);
  const simular = async (v: any) => {
    setVars(v);
    setRes(await api('/reglas/simular', { method: 'POST', body: v }).catch(() => null));
  };
  // Calcula el ejemplo inicial al abrir la pantalla
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    simular(vars);
  }, []);
  const bools = variables.filter((v) => v.tipo === 'bool');

  return (
    <div className="card stack-sm">
      <h4>Probar reglas</h4>
      <div className="row small">
        <select id="sim-cat" className="input" style={{ width: 'auto' }} aria-label="Categoría" value={vars.categoria ?? ''} onChange={(e) => simular({ ...vars, categoria: e.target.value || null })}>
          <option value="">Sin categoría</option>
          {cat?.categorias.map((c: any) => <option key={c.codigo} value={c.codigo}>Categoría: {c.nombre}</option>)}
        </select>
        {bools.map((b) => (
          <label key={b.codigo} className="check input" style={{ width: 'auto' }}>
            <input id={`sim-${b.codigo}`} type="checkbox" checked={!!vars[b.codigo]} onChange={(e) => simular({ ...vars, [b.codigo]: e.target.checked })} /> {b.codigo}
          </label>
        ))}
        <label className="check">
          Criticidad
          <input id="sim-crit" className="input" style={{ width: 70 }} type="number" min={1} max={5} value={vars.criticidad_ubicacion ?? ''} onChange={(e) => simular({ ...vars, criticidad_ubicacion: e.target.value ? Number(e.target.value) : null })} />
        </label>
        <button className="btn" onClick={() => simular(vars)}>Calcular</button>
        {res && <span>→ <b>{res.puntaje} pts</b> <Prioridad p={res.prioridad} /></span>}
      </div>
      {res?.reglas.length > 0 && <div className="small muted">Reglas aplicadas: {res.reglas.map((r: any) => `${r.nombre} (+${r.puntos})`).join(' · ')}</div>}
    </div>
  );
}

/** A10 · Reglas de prioridad */
export function Reglas() {
  const { datos, error, recargar } = useCarga('/reglas');
  const { ejecutar, Aviso } = useAccion();
  const [form, setForm] = useState<any>(null);

  if (error) return <ErrorBox msg={error} />;
  if (!datos) return <Cargando />;
  const rangos = datos.prioridades.map((p: any) => `${p.nombre} ${p.puntaje_min}–${p.puntaje_max >= 999 ? 'o más' : p.puntaje_max}`).join(' · ');

  return (
    <>
      <div className="row between">
        <div>
          <h3>Reglas de prioridad</h3>
          <div className="small muted">{rangos}</div>
        </div>
        <button className="btn pri" onClick={() => setForm({ variable: 'riesgo_personas', operador: '=', valor: 'true', puntos: 10, orden: 100, activo: true })}>+ Nueva regla</button>
      </div>
      <Aviso />
      <div className="card p0 wrap-x">
        <table className="t">
          <thead><tr><th>Orden</th><th>Regla</th><th>Condición</th><th>Puntos</th><th>Escala a</th><th>Activa</th><th /></tr></thead>
          <tbody>
            {datos.reglas.map((r: any) => (
              <tr key={r.id_regla} style={{ opacity: r.activo ? 1 : 0.55 }}>
                <td className="mono">{r.orden}</td>
                <td>{r.nombre}</td>
                <td className="mono small">{r.variable} {r.operador} {r.valor}</td>
                <td className="mono">{r.puntos >= 0 ? '+' : ''}{r.puntos}</td>
                <td>{r.fuerza && <Prioridad p={r.fuerza} />}</td>
                <td>
                  <Interruptor
                    activo={r.activo}
                    etiqueta={r.activo ? 'Desactivar regla' : 'Activar regla'}
                    onCambio={(v) => ejecutar(() => api(`/reglas/${r.id_regla}/activo`, { method: 'PATCH', body: { activo: v } })).then(recargar)}
                  />
                </td>
                <td><button className="btn ghost" onClick={() => setForm(r)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Simulador variables={datos.variables} />
      <div className="small muted">Los cambios no recalculan los incidentes ya creados; solo afectan a los nuevos.</div>
      {form && <FormRegla inicial={form} datos={datos} onCerrar={() => setForm(null)} onGuardado={() => { setForm(null); recargar(); }} />}
    </>
  );
}
