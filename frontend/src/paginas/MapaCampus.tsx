import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { CAMPUS } from '../datos/campusUnemi';
import { Cargando, ErrorBox, useCarga } from '../ui';

type ResumenBloque = { id_bloque: number; codigo: string; nombre: string; ubicaciones: number; total: number; activos: number; altas: number };

/** Color de cada edificio según sus incidentes sin resolver (mismo criterio que el semáforo del panel). */
function estadoBloque(r?: ResumenBloque) {
  if (!r) return 'sin-registro';
  if (r.altas > 0) return 'alta';
  if (r.activos > 0) return 'activos';
  return 'normal';
}

const ZONA_CLASE: Record<string, string> = { pitch: 'z-cancha', track: 'z-cancha', swimming_pool: 'z-agua', parking: 'z-parqueo' };
const ZOOM_MAX = 5;
const PASO = 1.5;

/**
 * A06 · Mapa del campus UNEMI. Plano tomado de OpenStreetMap; cada bloque se pinta según sus incidentes
 * sin resolver y, al elegirlo, se abre en la estructura de Ubicaciones. Zoom con + / − y arrastre para moverse.
 */
export function MapaCampus({ seleccionado, onElegir }: { seleccionado: number | null; onElegir: (idBloque: number) => void }) {
  const [dias, setDias] = useState(90);
  const { datos, error } = useCarga<ResumenBloque[]>(`/infraestructura/mapa?dias=${dias}`);
  const [encima, setEncima] = useState<string | null>(null);
  // Vista: nivel de zoom y centro en coordenadas del plano
  const [vista, setVista] = useState({ z: 1, cx: CAMPUS.ancho / 2, cy: CAMPUS.alto / 2 });
  const svg = useRef<SVGSVGElement>(null);
  const arrastre = useRef<{ x: number; y: number; cx: number; cy: number; movido: boolean } | null>(null);

  const porCodigo = new Map((datos ?? []).map((b) => [b.codigo, b]));
  const elegido = datos?.find((b) => b.id_bloque === seleccionado);
  const info = (encima ? porCodigo.get(encima) : null) ?? elegido ?? null;
  const conProblemas = (datos ?? []).filter((b) => b.activos > 0).sort((a, b) => b.altas - a.altas || b.activos - a.activos);

  // viewBox según el zoom, sin salirse del plano
  const w = CAMPUS.ancho / vista.z;
  const h = CAMPUS.alto / vista.z;
  const limitar = (cx: number, cy: number, z: number) => {
    const [mw, mh] = [CAMPUS.ancho / z / 2, CAMPUS.alto / z / 2];
    return { z, cx: Math.min(Math.max(cx, mw), CAMPUS.ancho - mw), cy: Math.min(Math.max(cy, mh), CAMPUS.alto - mh) };
  };
  const zoom = (factor: number) => setVista((v) => limitar(v.cx, v.cy, Math.min(ZOOM_MAX, Math.max(1, v.z * factor))));
  const x = vista.cx - w / 2;
  const y = vista.cy - h / 2;

  // Arrastrar para moverse (solo con zoom): se distingue de un clic sobre un bloque
  const bajar = (e: PointerEvent) => {
    if (vista.z === 1) return;
    arrastre.current = { x: e.clientX, y: e.clientY, cx: vista.cx, cy: vista.cy, movido: false };
  };
  const mover = (e: PointerEvent) => {
    const a = arrastre.current;
    if (!a || !svg.current) return;
    const escala = w / svg.current.getBoundingClientRect().width;
    const [dx, dy] = [e.clientX - a.x, e.clientY - a.y];
    if (!a.movido && Math.hypot(dx, dy) > 5) {
      a.movido = true;
      svg.current.setPointerCapture(e.pointerId);
    }
    if (a.movido) setVista(limitar(a.cx - dx * escala, a.cy - dy * escala, vista.z));
  };
  const soltar = () => {
    // El clic que sigue a un arrastre no debe elegir el bloque
    if (arrastre.current?.movido) setTimeout(() => (arrastre.current = null), 0);
    else arrastre.current = null;
  };
  const elegir = (r?: ResumenBloque) => {
    if (r && !arrastre.current?.movido) onElegir(r.id_bloque);
  };
  const teclado = (e: KeyboardEvent, r?: ResumenBloque) => {
    if (r && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onElegir(r.id_bloque);
    }
  };

  return (
    <div className="card stack mapa-card">
      <div className="stack-sm">
        <div className="row between" style={{ flexWrap: 'nowrap' }}>
          <h4>Mapa del campus</h4>
          <select id="mapa-periodo" className="input" style={{ width: 'auto' }} aria-label="Periodo del mapa" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
            <option value={365}>Último año</option>
          </select>
        </div>
        <div className="small muted">Elige un bloque para ver sus ubicaciones. El color indica los incidentes sin resolver.</div>
      </div>
      {error ? (
        <ErrorBox msg={error} />
      ) : !datos ? (
        <Cargando />
      ) : (
        <>
          <div className="mapa-lienzo">
            <svg
              ref={svg}
              viewBox={`${x} ${y} ${w} ${h}`}
              role="group"
              aria-label="Plano del campus con sus bloques"
              className={vista.z > 1 ? 'con-zoom' : undefined}
              onPointerDown={bajar}
              onPointerMove={mover}
              onPointerUp={soltar}
              onPointerCancel={soltar}
            >
              <path className="m-contorno" d={CAMPUS.contorno} />
              {CAMPUS.zonas.map((z, i) => (
                <path key={i} className={`m-zona ${ZONA_CLASE[z.tipo] ?? ''}`} d={z.d}>
                  {z.nombre && <title>{z.nombre}</title>}
                </path>
              ))}
              {CAMPUS.edificios.map((e, i) => {
                const r = e.codigo ? porCodigo.get(e.codigo) : undefined;
                const clase = `m-edificio e-${estadoBloque(r)}${r && r.id_bloque === seleccionado ? ' e-sel' : ''}`;
                const etiqueta = r
                  ? `${r.nombre}: ${r.activos ? `${r.activos} sin resolver${r.altas ? `, ${r.altas} de prioridad alta` : ''}` : 'sin incidentes pendientes'}`
                  : `${e.nombre} (no registrado en el sistema)`;
                return (
                  <g
                    key={i}
                    className={clase}
                    role={r ? 'button' : undefined}
                    tabIndex={r ? 0 : undefined}
                    aria-label={etiqueta}
                    aria-pressed={r ? r.id_bloque === seleccionado : undefined}
                    onClick={() => elegir(r)}
                    onKeyDown={(ev) => teclado(ev, r)}
                    onMouseEnter={() => setEncima(e.codigo)}
                    onMouseLeave={() => setEncima(null)}
                    onFocus={() => setEncima(e.codigo)}
                    onBlur={() => setEncima(null)}
                  >
                    <title>{etiqueta}</title>
                    <path d={e.d} />
                    {e.codigo && (
                      <text x={e.c[0]} y={e.c[1]} dominantBaseline="central" textAnchor="middle" className={e.codigo.length > 1 ? 'largo' : undefined}>
                        {e.codigo.slice(0, 4)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            <div className="mapa-zoom" role="group" aria-label="Zoom del mapa">
              <button type="button" onClick={() => zoom(PASO)} disabled={vista.z >= ZOOM_MAX} aria-label="Acercar" title="Acercar">+</button>
              <button type="button" onClick={() => zoom(1 / PASO)} disabled={vista.z <= 1} aria-label="Alejar" title="Alejar">−</button>
              <button type="button" onClick={() => setVista({ z: 1, cx: CAMPUS.ancho / 2, cy: CAMPUS.alto / 2 })} disabled={vista.z === 1} aria-label="Ver todo el campus" title="Ver todo el campus">⟲</button>
            </div>
            {vista.z > 1 && <div className="mapa-ayuda small">Arrastra para moverte</div>}
          </div>

          <div className="leyenda-mapa small">
            <span><i className="e-alta" /> Prioridad alta pendiente</span>
            <span><i className="e-activos" /> Incidentes sin resolver</span>
            <span><i className="e-normal" /> Sin pendientes</span>
            <span><i className="e-sin-registro" /> No registrado</span>
          </div>
          <div className="notice" aria-live="polite">
            {info ? (
              <>
                <b>{info.nombre}</b> · {info.ubicaciones} {info.ubicaciones === 1 ? 'ubicación' : 'ubicaciones'}
                <br />
                {info.total} {info.total === 1 ? 'incidente' : 'incidentes'} en el periodo · {info.activos} sin resolver · {info.altas} de prioridad alta
              </>
            ) : (
              'Pasa el cursor o toca un bloque para ver su resumen.'
            )}
          </div>
          {conProblemas.length > 0 && (
            <div className="stack-sm">
              <b className="small">Bloques con pendientes ({conProblemas.length})</b>
              <div className="chips mapa-chips">
                {conProblemas.map((b) => (
                  <button key={b.id_bloque} type="button" className={`chip${b.id_bloque === seleccionado ? ' on' : ''}`} onClick={() => onElegir(b.id_bloque)}>
                    {b.nombre} · {b.activos}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="small muted">
            Plano: ©{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">colaboradores de OpenStreetMap</a>
          </div>
        </>
      )}
    </div>
  );
}
