import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useSesion } from '../auth';
import { Cargando, ErrorBox, Estado, LeyendaPlazo, Plazo, Prioridad, textoAsignacion, useIntervalo } from '../ui';

/** T01 · Mis incidentes (técnico) */
export function MisIncidentes() {
  const { usuario } = useSesion();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [resumen, setResumen] = useState<any>(null);
  const [filas, setFilas] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const q = params.get('q') ?? '';

  const cargar = () =>
    Promise.all([api('/dashboard'), api(`/incidentes?activos=1&porPagina=50${q ? `&q=${encodeURIComponent(q)}` : ''}`)])
      .then(([d, inc]) => {
        setResumen(d.resumen);
        setFilas(inc.filas);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useIntervalo(() => void cargar(), 10000);

  if (error) return <ErrorBox msg={error} />;
  if (!resumen || !filas) return <Cargando />;
  const activos = resumen.por_iniciar + resumen.en_proceso + resumen.en_verificacion;

  return (
    <>
      <div className="row between">
        <div>
          <h3>Hola, {usuario?.nombres}</h3>
          <div className="crumb">Tienes {activos} incidente{activos === 1 ? '' : 's'} activo{activos === 1 ? '' : 's'}</div>
        </div>
      </div>
      <div className="grid g4">
        <div className="card kpi"><div className="l">Por iniciar</div><div className="v">{resumen.por_iniciar}</div></div>
        <div className="card kpi"><div className="l">En proceso</div><div className="v">{resumen.en_proceso}</div></div>
        <div className="card kpi"><div className="l">En verificación</div><div className="v">{resumen.en_verificacion}</div></div>
        <div className="card kpi"><div className="l">Resueltos este mes</div><div className="v">{resumen.resueltos_mes}</div></div>
      </div>
      <LeyendaPlazo />
      {q && <div className="small muted">Resultados para “{q}”</div>}
      {filas.length === 0 ? (
        <div className="card empty">No tienes incidentes activos{q ? ' con esa búsqueda' : ''}.</div>
      ) : (
        <div className="grid g3">
          {filas.map((i) => (
            <div key={i.id_incidente} className="card click" style={{ display: 'flex', flexDirection: 'column', gap: 8 }} onClick={() => navigate(`/mis-incidentes/${i.codigo}`)}>
              <div className="row between"><Prioridad p={i.prioridad} /><Estado s={i.estado} /></div>
              <b>{i.titulo}</b>
              <div className="small muted">{i.ubicacion_codigo ? `${i.ubicacion_codigo} · ${i.ubicacion}` : i.ubicacion_texto}</div>
              <div className="small mono">{i.codigo}</div>
              <div className="small"><Plazo inc={i} /></div>
              {i.asignacion_actual && <div className="small muted">{textoAsignacion(i.asignacion_actual)}</div>}
              {i.estado === 'ASIGNADO' ? (
                <button className="btn pri block">Iniciar atención</button>
              ) : i.estado === 'EN_PROCESO' ? (
                <button className="btn dark block">Registrar avance / cerrar</button>
              ) : (
                <div className="small muted">Esperando verificación del coordinador</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
