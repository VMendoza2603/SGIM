import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';

export const ESTADOS: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  ASIGNADO: 'Asignado',
  EN_PROCESO: 'En proceso',
  EN_VERIFICACION: 'En verificación',
  RESUELTO: 'Resuelto',
  CANCELADO: 'Cancelado',
};

export const Prioridad = ({ p }: { p?: string | null }) =>
  p ? <span className={`pill p-${p}`}>{p[0] + p.slice(1).toLowerCase()}</span> : <span className="muted small">—</span>;

export const Estado = ({ s }: { s: string }) => <span className={`pill s-${s}`}>{ESTADOS[s] ?? s}</span>;

const dosDig = (n: number) => String(n).padStart(2, '0');
/** 11/10 10:42 — o solo la hora si es hoy. */
export function fechaCorta(iso?: string | null, soloHoraSiHoy = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  const hora = `${dosDig(d.getHours())}:${dosDig(d.getMinutes())}`;
  if (soloHoraSiHoy && d.toDateString() === new Date().toDateString()) return hora;
  return `${dosDig(d.getDate())}/${dosDig(d.getMonth() + 1)} ${hora}`;
}
export const fechaLarga = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${dosDig(d.getDate())}/${dosDig(d.getMonth() + 1)}/${d.getFullYear()} ${dosDig(d.getHours())}:${dosDig(d.getMinutes())}`;
};
export const soloFecha = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${dosDig(d.getDate())}/${dosDig(d.getMonth() + 1)}/${d.getFullYear()}`;
};
export const hora = (iso?: string | null) => (iso ? fechaCorta(iso).slice(-5) : '—');

export const TIPO_MIEMBRO: Record<string, string> = { ESTUDIANTE: 'Estudiante', DOCENTE: 'Docente', ADMINISTRATIVO: 'Personal administrativo' };

/** Foto de evidencia; si el archivo no existe, muestra el recuadro rayado del prototipo con su descripción. */
export function Foto({ url, texto }: { url?: string | null; texto: ReactNode }) {
  const [fallo, setFallo] = useState(!url);
  useEffect(() => {
    setFallo(!url);
  }, [url]);
  return (
    <div className={`photo ${fallo ? '' : 'has-img'}`}>
      {fallo ? texto : <img src={url!} alt={typeof texto === 'string' ? texto : ''} onError={() => setFallo(true)} />}
    </div>
  );
}

const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Ventana modal accesible: Escape cierra, el foco entra al diálogo al abrirse, Tab no se sale de él
 * y al cerrarse el foco vuelve al botón que lo abrió (navegación solo con teclado o lector de pantalla).
 */
export function Dialogo({ titulo, children, onCerrar }: { titulo: string; children: ReactNode; onCerrar: () => void }) {
  const caja = useRef<HTMLDivElement>(null);
  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    const primero = caja.current?.querySelector<HTMLElement>(ENFOCABLES);
    if (!caja.current?.contains(document.activeElement)) (primero ?? caja.current)?.focus();
    const teclas = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return cerrar.current();
      if (e.key !== 'Tab' || !caja.current) return;
      const lista = [...caja.current.querySelectorAll<HTMLElement>(ENFOCABLES)];
      if (!lista.length) return;
      const [a, z] = [lista[0], lista[lista.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener('keydown', teclas);
    return () => {
      window.removeEventListener('keydown', teclas);
      previo?.focus?.();
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={titulo} ref={caja} tabIndex={-1}>
        <h3>{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

/** Campo de contraseña con el botón 👁 para mostrar u ocultar lo escrito (mismo estilo que el inicio de sesión). */
export function InputContrasena({ id, value, onChange, autoComplete = 'new-password', required }: { id: string; value: string; onChange: (v: string) => void; autoComplete?: string; required?: boolean }) {
  const [ver, setVer] = useState(false);
  return (
    <div className="input-wrap">
      <input id={id} className="input" type={ver ? 'text' : 'password'} autoComplete={autoComplete} required={required} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" onClick={() => setVer(!ver)} aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={ver} title={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
        <IconoOjo tachado={ver} />
      </button>
    </div>
  );
}

/** Ojo abierto = la contraseña está oculta (pulsa para verla); ojo tachado = se está viendo (pulsa para ocultarla). */
function IconoOjo({ tachado }: { tachado: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {tachado && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

export const Cargando = () => <div className="empty">Cargando…</div>;
export const ErrorBox = ({ msg }: { msg: string }) => <div className="notice n-bad">{msg}</div>;

export const iniciales = (n: string, a: string) => `${n[0] ?? ''}${a[0] ?? ''}`.toUpperCase();

/** Carga datos de la API con estado de carga/error y una función para recargar. */
export function useCarga<T = any>(ruta: string | null) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  // Última ruta que cargó bien: si un refresco automático de esa misma ruta falla (red inestable, servidor reiniciándose),
  // se conservan los datos en pantalla en lugar de reemplazarlos por el error.
  const cargada = useRef<string | null>(null);
  useEffect(() => {
    if (!ruta) return;
    let vigente = true;
    api<T>(ruta)
      .then((d) => {
        if (!vigente) return;
        cargada.current = ruta;
        setError('');
        setDatos(d);
      })
      .catch((e) => {
        if (!vigente) return;
        if (cargada.current === ruta && (e.status === 0 || e.status >= 500)) return;
        setError(e.message);
      });
    return () => {
      vigente = false;
    };
  }, [ruta, version]);
  return { datos, error, recargar: () => setVersion((v) => v + 1), setDatos };
}

/** Ejecuta una acción mostrando el resultado en un aviso; devuelve true si salió bien. */
export function useAccion() {
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'bad'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ejecutar = async (fn: () => Promise<unknown>, ok?: string) => {
    setAviso(null);
    setOcupado(true);
    try {
      await fn();
      if (ok) setAviso({ tipo: 'ok', texto: ok });
      return true;
    } catch (e) {
      setAviso({ tipo: 'bad', texto: (e as Error).message });
      return false;
    } finally {
      setOcupado(false);
    }
  };
  const Aviso = () => (aviso ? <div className={`notice n-${aviso.tipo}`} role="status">{aviso.texto}</div> : null);
  return { ejecutar, ocupado, Aviso, limpiar: () => setAviso(null) };
}

export function Interruptor({ activo, onCambio, etiqueta, deshabilitado }: { activo: boolean; onCambio: (v: boolean) => void; etiqueta: string; deshabilitado?: boolean }) {
  return (
    <button
      type="button"
      className={`toggle ${activo ? '' : 'off'}`}
      aria-pressed={activo}
      aria-label={etiqueta}
      title={etiqueta}
      disabled={deshabilitado}
      onClick={(e) => {
        e.stopPropagation();
        onCambio(!activo);
      }}
    />
  );
}

export function Campo({ id, etiqueta, children, ayuda, className }: { id: string; etiqueta: string; children: ReactNode; ayuda?: ReactNode; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {ayuda && <span className="muted">{ayuda}</span>}
    </div>
  );
}

/** Muestra una contraseña temporal una sola vez, con botón para copiarla. */
export function ContrasenaTemporal({ valor, onCerrar, para }: { valor: string; onCerrar: () => void; para: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Dialogo titulo="Contraseña temporal" onCerrar={onCerrar}>
      <div className="small">
        Entrégale esta contraseña a <b>{para}</b>. Solo se muestra ahora; deberá cambiarla en su primer ingreso.
      </div>
      <div className="secreto">{valor}</div>
      <div className="row end">
        <button
          className="btn"
          onClick={() => navigator.clipboard?.writeText(valor).then(() => setCopiado(true)).catch(() => undefined)}
        >
          {copiado ? '✓ Copiada' : 'Copiar'}
        </button>
        <button className="btn pri" onClick={onCerrar}>Listo</button>
      </div>
    </Dialogo>
  );
}

/* ---------- Exportar a Excel (.xlsx) sin librer\u00edas ----------
   Un .xlsx es un ZIP con archivos XML. Se arma aqu\u00ed (ZIP sin compresi\u00f3n) para poder fijar el ancho
   de cada columna: con CSV, Excel mostraba las fechas como ##### porque la columna quedaba angosta. */
const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = TABLA_CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zipSinCompresion(archivos: { nombre: string; contenido: string }[]) {
  const enc = new TextEncoder();
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of archivos) {
    const nombre = enc.encode(f.nombre);
    const datos = enc.encode(f.contenido);
    const crc = crc32(datos);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true);
    local.setUint16(12, 0x21, true); // fecha DOS fija (1980-01-01)
    local.setUint32(14, crc, true); local.setUint32(18, datos.length, true); local.setUint32(22, datos.length, true);
    local.setUint16(26, nombre.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(14, 0x21, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, datos.length, true); cd.setUint32(24, datos.length, true);
    cd.setUint16(28, nombre.length, true); cd.setUint32(42, offset, true);
    partes.push(new Uint8Array(local.buffer), nombre, datos);
    central.push(new Uint8Array(cd.buffer), nombre);
    offset += 30 + nombre.length + datos.length;
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)] as BlobPart[], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const letraColumna = (i: number): string => (i >= 26 ? letraColumna(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

/** Descarga filas como Excel (.xlsx): encabezado en negrita, fijo y con filtro, y columnas ajustadas al contenido. */
export function descargarExcel(nombre: string, cabeceras: string[], filas: unknown[][]) {
  const todas = [cabeceras, ...filas];
  const anchos = cabeceras.map((_, c) =>
    Math.min(60, Math.max(8, ...todas.map((f) => String(f[c] ?? '').length + 2))),
  );
  const celda = (v: unknown, r: number, c: number, estilo: number) => {
    const ref = `${letraColumna(c)}${r + 1}`;
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${estilo}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v ?? ''))}</t></is></c>`;
  };
  const ultima = `${letraColumna(cabeceras.length - 1)}${todas.length}`;
  const hoja =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${todas.map((f, r) => `<row r="${r + 1}">${f.map((v, c) => celda(v, r, c, r === 0 ? 1 : 0)).join('')}</row>`).join('')}</sheetData>` +
    `<autoFilter ref="A1:${ultima}"/></worksheet>`;
  const blob = zipSinCompresion([
    { nombre: '[Content_Types].xml', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { nombre: '_rels/.rels', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nombre: 'xl/workbook.xml', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="SGIM" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">SGIM!$A$1:$' + letraColumna(cabeceras.length - 1) + '$' + todas.length + '</definedName></definedNames></workbook>' },
    { nombre: 'xl/_rels/workbook.xml.rels', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { nombre: 'xl/styles.xml', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>' },
    { nombre: 'xl/worksheets/sheet1.xml', contenido: hoja },
  ]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre.replace(/\.(csv|xlsx)$/i, '') + '.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const ESTADO_EQUIPO: Record<string, { texto: string; clase: string }> = {
  OPERATIVO: { texto: 'Operativo', clase: 's-RESUELTO' },
  CON_FALLA: { texto: 'Con falla', clase: 's-EN_PROCESO' },
  FUERA_DE_SERVICIO: { texto: 'Fuera de servicio', clase: 'p-ALTA' },
  DADO_DE_BAJA: { texto: 'Dado de baja', clase: 's-CANCELADO' },
};

/** Devuelve el valor después de una pausa de escritura (evita consultar la API en cada tecla). */
export function useDiferido<T>(valor: T, ms = 300) {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

/**
 * Ejecuta `fn` cada `ms` milisegundos mientras la pestaña está visible (actualización casi en tiempo real
 * por consulta periódica; funciona igual en local y en Vercel). Al volver a la pestaña refresca enseguida.
 */
export function useIntervalo(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') ref.current();
    };
    const id = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms]);
}

/** Muestra el formato de WhatsApp (*negrita* y _cursiva_) en el panel. */
export function TextoWhatsApp({ texto }: { texto: string }) {
  const partes = texto.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return (
    <>
      {partes.map((p, i) =>
        /^\*[^*]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b> : /^_[^_]+_$/.test(p) ? <i key={i}>{p.slice(1, -1)}</i> : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  );
}

// ---------------------------------------------------------------- Plazo de reparación (semáforo)
/** Duración legible: 45 min, 8 h, 2 días, 1,5 días. */
export function duracion(ms: number) {
  const h = Math.abs(ms) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  const d = Math.round((h / 24) * 2) / 2;
  return `${String(d).replace('.', ',')} días`;
}

export type NivelPlazo = 'ok' | 'warn' | 'bad' | 'fin';
type ConPlazo = { fecha_reporte: string; fecha_limite?: string | null; fecha_resolucion?: string | null; es_final?: boolean; estado?: string };

/**
 * Semáforo del tiempo estimado de reparación (el plazo sale de la prioridad o lo ajusta el coordinador):
 * verde = queda más de la mitad · amarillo = queda la mitad o menos · rojo = fuera de plazo.
 * Cuando el técnico ya terminó, dice si fue a tiempo o con retraso.
 */
export function estadoPlazo(i: ConPlazo): { nivel: NivelPlazo; estimado: string; detalle: string } | null {
  if (!i.fecha_limite) return null;
  const inicio = new Date(i.fecha_reporte).getTime();
  const limite = new Date(i.fecha_limite).getTime();
  const estimado = duracion(limite - inicio);
  const terminado = i.fecha_resolucion ? new Date(i.fecha_resolucion).getTime() : null;
  if (terminado || i.es_final) {
    if (!terminado) return { nivel: 'fin', estimado, detalle: 'cerrado' };
    return terminado <= limite ? { nivel: 'fin', estimado, detalle: 'terminado a tiempo' } : { nivel: 'bad', estimado, detalle: `terminado con ${duracion(terminado - limite)} de retraso` };
  }
  const ahora = Date.now();
  if (ahora > limite) return { nivel: 'bad', estimado, detalle: `fuera de plazo hace ${duracion(ahora - limite)}` };
  const resto = (limite - ahora) / Math.max(1, limite - inicio);
  return { nivel: resto > 0.5 ? 'ok' : 'warn', estimado, detalle: `quedan ${duracion(limite - ahora)}` };
}

const TEXTO_NIVEL: Record<NivelPlazo, string> = { ok: 'A tiempo', warn: 'Por vencer', bad: 'Fuera de plazo', fin: 'Terminado' };

/** Tiempo estimado con su luz de semáforo; `corto` muestra solo lo que queda (para tablas). */
export function Plazo({ inc, corto }: { inc: ConPlazo; corto?: boolean }) {
  const p = estadoPlazo(inc);
  if (!p) return <span className="muted">—</span>;
  return (
    <span className={`plazo pl-${p.nivel}`} title={`${TEXTO_NIVEL[p.nivel]} · tiempo estimado ${p.estimado} · ${p.detalle}`}>
      <i className="sem" aria-hidden="true" />
      <span className="sr">{TEXTO_NIVEL[p.nivel]}: </span>
      {corto ? p.detalle : `${p.estimado} · ${p.detalle}`}
    </span>
  );
}

export function LeyendaPlazo() {
  return (
    <div className="row small muted leyenda" aria-label="Semáforo del tiempo estimado">
      <span className="plazo pl-ok"><i className="sem" aria-hidden="true" />Queda más de la mitad del tiempo</span>
      <span className="plazo pl-warn"><i className="sem" aria-hidden="true" />Por vencer (la mitad o menos)</span>
      <span className="plazo pl-bad"><i className="sem" aria-hidden="true" />Fuera de plazo</span>
    </div>
  );
}

// ---------------------------------------------------------------- Asignación
export type AsignacionActual = { en: string; automatica: boolean; por: string | null } | null | undefined;

/** "Asignado el 31/10 23:59 por Sistema (automática)" o "... por Coordinador M." */
export function textoAsignacion(a: AsignacionActual) {
  if (!a) return null;
  return `Asignado el ${fechaCorta(a.en)} por ${a.automatica || !a.por ? 'Sistema (automática)' : a.por}`;
}

// ---------------------------------------------------------------- Teléfono (+593)
/**
 * Celular con el prefijo +593 fijo: se escribe con o sin el 0 inicial (0987654321 o 987654321)
 * y se entrega siempre como lo guarda el sistema y lo usa WhatsApp (593987654321).
 */
export function Telefono({ id, value, onChange, required }: { id: string; value: string | null | undefined; onChange: (v: string) => void; required?: boolean }) {
  const local = (value ?? '').replace(/^593/, '');
  return (
    <div className="tel">
      <span className="pref" aria-hidden="true">+593</span>
      <input
        id={id}
        className="input"
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="98 765 4321"
        pattern="[0-9]{9}"
        title="9 dígitos; el 0 inicial es opcional"
        required={required}
        value={local}
        onChange={(e) => {
          let d = e.target.value.replace(/\D/g, '');
          if (d.startsWith('593') && d.length > 9) d = d.slice(3);
          d = d.replace(/^0/, '').slice(0, 9);
          onChange(d ? `593${d}` : '');
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- Tema y accesibilidad
export type Tema = 'claro' | 'oscuro';
/** Tamaños del panel de accesibilidad: A- · A · A+ · A++ · A+++ (el factor de cada uno está en styles.css). */
export type TamanoTexto = 'chico' | 'normal' | 'grande' | 'muy-grande' | 'enorme';
export const TAMANOS: { id: TamanoTexto; texto: string; nombre: string }[] = [
  { id: 'chico', texto: 'A-', nombre: 'pequeño' },
  { id: 'normal', texto: 'A', nombre: 'normal' },
  { id: 'grande', texto: 'A+', nombre: 'grande' },
  { id: 'muy-grande', texto: 'A++', nombre: 'muy grande' },
  { id: 'enorme', texto: 'A+++', nombre: 'el más grande' },
];
/** Opciones de sí/no del panel de accesibilidad. Cada una se guarda en el navegador y se refleja como data-* en <html>. */
export const OPCIONES_A11Y = [
  { id: 'ajustar', titulo: 'Ajustar al tamaño de la pantalla', ayuda: 'En monitores grandes agranda toda la interfaz.' },
  { id: 'voz', titulo: 'Lectura en voz alta', ayuda: 'Muestra una barra para escuchar la página o el texto seleccionado.' },
  { id: 'contraste', titulo: 'Alto contraste', ayuda: '' },
  { id: 'subrayar', titulo: 'Subrayar enlaces', ayuda: '' },
  { id: 'espaciado', titulo: 'Aumentar espaciado del texto', ayuda: '' },
] as const;
export type OpcionA11y = (typeof OPCIONES_A11Y)[number]['id'];
const leer = (clave: string) => {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
};
const guardar = (clave: string, valor: string) => {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento: dura solo esta visita */
  }
};

const raiz = () => document.documentElement;
const ponerOpcion = (id: OpcionA11y, activa: boolean) => {
  if (activa) raiz().dataset[id] = 'si';
  else delete raiz().dataset[id];
};

/** Aplica al documento el tema y las opciones de accesibilidad guardadas (o el modo del sistema operativo la primera vez). */
export function aplicarPreferencias() {
  const sistema: Tema = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  raiz().dataset.tema = (leer('sgim.tema') as Tema) ?? sistema;
  const texto = leer('sgim.texto') as TamanoTexto | null;
  raiz().dataset.texto = texto && TAMANOS.some((t) => t.id === texto) ? texto : 'normal';
  for (const o of OPCIONES_A11Y) ponerOpcion(o.id, leer(`sgim.a11y.${o.id}`) === 'si');
}

/** Modo claro/oscuro y opciones de accesibilidad; cada navegador recuerda su elección. */
export function usePreferencias() {
  const [tema, setTema] = useState<Tema>(() => (raiz().dataset.tema as Tema) || 'claro');
  const [texto, setTexto] = useState<TamanoTexto>(() => (raiz().dataset.texto as TamanoTexto) || 'normal');
  const [opciones, setOpciones] = useState<Record<OpcionA11y, boolean>>(
    () => Object.fromEntries(OPCIONES_A11Y.map((o) => [o.id, raiz().dataset[o.id] === 'si'])) as Record<OpcionA11y, boolean>,
  );
  const cambiarTema = () => {
    const t: Tema = tema === 'oscuro' ? 'claro' : 'oscuro';
    raiz().dataset.tema = t;
    guardar('sgim.tema', t);
    setTema(t);
  };
  const cambiarTexto = (t: TamanoTexto) => {
    raiz().dataset.texto = t;
    guardar('sgim.texto', t);
    setTexto(t);
  };
  const cambiarOpcion = (id: OpcionA11y, activa: boolean) => {
    ponerOpcion(id, activa);
    guardar(`sgim.a11y.${id}`, activa ? 'si' : 'no');
    setOpciones((o) => ({ ...o, [id]: activa }));
  };
  /** «Restablecer valores»: tamaño normal y todas las opciones apagadas (el modo claro/oscuro no se toca). */
  const restablecer = () => {
    cambiarTexto('normal');
    for (const o of OPCIONES_A11Y) cambiarOpcion(o.id, false);
  };
  return { tema, texto, opciones, cambiarTema, cambiarTexto, cambiarOpcion, restablecer };
}

/** Parte un texto largo en frases (los navegadores cortan la lectura de textos muy largos). */
const frases = (texto: string) =>
  texto
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;:])\s+/)
    .flatMap((f) => (f.length > 200 ? f.match(/.{1,200}(\s|$)/g) ?? [f] : [f]))
    .map((f) => f.trim())
    .filter(Boolean);

/**
 * Lectura en voz alta con la voz en español del propio navegador (Web Speech API): gratis y sin servicios externos.
 * Lee el texto seleccionado o, si no hay selección, el contenido de la pantalla.
 */
export function useLecturaVoz() {
  const soportada = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [estado, setEstado] = useState<'detenida' | 'leyendo' | 'pausada'>('detenida');
  useEffect(() => {
    return () => {
      if (soportada) window.speechSynthesis.cancel();
    };
  }, [soportada]);
  const leerTexto = () => {
    if (!soportada) return;
    const seleccion = window.getSelection()?.toString().trim();
    const texto = seleccion || (document.querySelector('.content') as HTMLElement | null)?.innerText || '';
    const partes = frases(texto);
    if (!partes.length) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const voz = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith('es'));
    partes.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = voz?.lang ?? 'es-ES';
      if (voz) u.voice = voz;
      if (i === partes.length - 1) u.onend = () => setEstado('detenida');
      synth.speak(u);
    });
    setEstado('leyendo');
  };
  const pausar = () => {
    if (estado === 'leyendo') {
      window.speechSynthesis.pause();
      setEstado('pausada');
    } else if (estado === 'pausada') {
      window.speechSynthesis.resume();
      setEstado('leyendo');
    }
  };
  const detener = () => {
    if (soportada) window.speechSynthesis.cancel();
    setEstado('detenida');
  };
  return { soportada, estado, leerTexto, pausar, detener };
}
