import { useEffect, useState } from 'react';
import { api } from '../api';
import { Campo, Cargando, ErrorBox, fechaCorta, Interruptor, Prioridad, useAccion, useCarga } from '../ui';

/** Parámetros agrupados por tarjeta, en el orden del prototipo (A13). */
const GRUPOS = [
  { titulo: 'Agente de IA', claves: ['ia.umbral_confianza', 'verificacion.umbral_ia', 'verificacion.horas_confirmar', 'asignacion.automatica', 'ia.modelo_texto', 'ia.modelo_vision'] },
  { titulo: 'WhatsApp Business', claves: ['wa.phone_number_id', 'wa.mensaje_bienvenida'] },
  { titulo: 'Seguridad', claves: ['seguridad.max_intentos_login', 'seguridad.minutos_bloqueo', 'archivo.max_mb'] },
];

/** A13 · Configuración */
export function Configuracion() {
  const { datos, error, recargar } = useCarga('/configuracion');
  const { ejecutar, Aviso, ocupado } = useAccion();
  const [valores, setValores] = useState<Record<string, string>>({});
  const [sla, setSla] = useState<any[]>([]);

  useEffect(() => {
    if (!datos) return;
    setValores(Object.fromEntries(datos.parametros.map((p: any) => [p.clave, p.valor])));
    setSla(datos.prioridades);
  }, [datos]);

  if (error) return <ErrorBox msg={error} />;
  if (!datos) return <Cargando />;

  const param = (clave: string) => datos.parametros.find((p: any) => p.clave === clave);
  const cambiados = () => Object.fromEntries(Object.entries(valores).filter(([k, v]) => param(k)?.valor !== v));

  const guardar = () =>
    ejecutar(async () => {
      const c = cambiados();
      if (Object.keys(c).length) await api('/configuracion/parametros', { method: 'PUT', body: c });
      await api('/configuracion/prioridades', {
        method: 'PUT',
        body: sla.map((p) => ({ id_prioridad: p.id_prioridad, horas_respuesta: Number(p.horas_respuesta), horas_solucion: Number(p.horas_solucion) })),
      });
    }, 'Configuración guardada.').then((ok) => ok && recargar());

  const control = (clave: string) => {
    const p = param(clave);
    if (!p) return null;
    const v = valores[clave] ?? '';
    const id = `cfg-${clave.replace(/\./g, '-')}`;
    if (p.tipo_dato === 'BOOL') {
      return (
        <div className="row small" key={clave}>
          <Interruptor activo={v === 'true'} etiqueta={p.descripcion} onCambio={(b) => setValores({ ...valores, [clave]: String(b) })} /> {p.descripcion}
        </div>
      );
    }
    return (
      <Campo key={clave} id={id} etiqueta={p.descripcion}>
        {clave === 'wa.mensaje_bienvenida' ? (
          <textarea id={id} className="input" value={v} onChange={(e) => setValores({ ...valores, [clave]: e.target.value })} />
        ) : (
          <input
            id={id}
            className={`input ${p.sensible ? 'mono' : ''}`}
            inputMode={p.tipo_dato === 'TEXT' ? undefined : 'decimal'}
            value={v}
            onFocus={() => p.sensible && v.startsWith('••') && setValores({ ...valores, [clave]: '' })}
            onBlur={() => p.sensible && v === '' && setValores({ ...valores, [clave]: p.valor })}
            onChange={(e) => setValores({ ...valores, [clave]: e.target.value })}
          />
        )}
      </Campo>
    );
  };

  return (
    <>
      <div className="row between">
        <h3>Configuración</h3>
        <button className="btn pri" disabled={ocupado} onClick={guardar}>Guardar cambios</button>
      </div>
      <Aviso />
      <div className="grid g2">
        <div className="card">
          <h4>Categorías y tiempos estimados</h4>
          <div className="wrap-x">
            <table className="t">
              <thead><tr><th>Prioridad</th><th>Primera respuesta (h)</th><th>Tiempo estimado de reparación (h)</th></tr></thead>
              <tbody>
                {sla.map((p, i) => (
                  <tr key={p.id_prioridad}>
                    <td><Prioridad p={p.codigo} /></td>
                    {(['horas_respuesta', 'horas_solucion'] as const).map((k) => (
                      <td key={k}>
                        <input
                          id={`sla-${p.codigo}-${k}`}
                          aria-label={`${k} ${p.nombre}`}
                          className="input mono"
                          style={{ width: 90 }}
                          type="number"
                          min={1}
                          value={p[k]}
                          onChange={(e) => setSla(sla.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {GRUPOS.map((g) => (
          <div className="card stack" key={g.titulo}>
            <h4>{g.titulo}</h4>
            {g.claves.map(control)}
            {g.titulo === 'WhatsApp Business' && (
              <div className="small" style={{ color: datos.whatsapp.ultimoEvento ? 'var(--ok)' : 'var(--ink-2)' }}>
                ● {datos.whatsapp.ultimoEvento ? `Último mensaje recibido: ${fechaCorta(datos.whatsapp.ultimoEvento)}` : 'Webhook aún sin eventos'}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="small muted">Los tokens y claves de Meta y de la IA no se guardan en la base de datos: viven en las variables de entorno del servidor.</div>
    </>
  );
}
