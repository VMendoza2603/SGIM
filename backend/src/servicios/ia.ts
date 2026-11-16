import fs from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { config, iaActiva } from '../config.js';
import { query, queryOne } from '../db.js';
import { DIR_UPLOADS } from './incidentes.js';

/**
 * Agente de IA (fase 6) con Gemini: un modelo multimodal que entiende la foto y el texto a la vez.
 *  - analizarReporte: sugiere la categoría, las variables de riesgo y un diagnóstico preliminar.
 *  - analizarCierre: compara la foto del reporte con la de cierre y dice si el daño se ve resuelto.
 * La IA no decide la prioridad: solo entrega las variables que evalúa el motor de reglas (calcularPrioridad).
 * Si Gemini falla o se agota la cuota, devuelve null y el sistema sigue con el flujo manual.
 */

const URL_GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const VERSION_PROMPT = 'v1';

export interface FotoIa {
  url: string; // /uploads/archivo.jpg (o una ruta del disco, en el script de prueba)
  mime: string;
}

interface RespuestaGemini {
  datos: any;
  modelo: string;
  cruda: unknown;
  tokensEntrada: number | null;
  tokensSalida: number | null;
  latenciaMs: number;
}

/** Valor numérico de parametro_sistema (umbral de confianza, etc.). */
export async function parametroNumero(clave: string, porDefecto: number) {
  const v = Number((await queryOne(`SELECT valor FROM parametro_sistema WHERE clave = $1`, [clave]))?.valor);
  return Number.isFinite(v) ? v : porDefecto;
}

async function parteImagen(foto: FotoIa) {
  let buffer: Buffer;
  if (/^https?:\/\//.test(foto.url)) {
    // Foto guardada en Vercel Blob (producción)
    const r = await fetch(foto.url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`No se pudo leer la foto (${r.status})`);
    buffer = Buffer.from(await r.arrayBuffer());
  } else {
    const archivo = foto.url.startsWith('/uploads/') ? path.join(DIR_UPLOADS, path.basename(foto.url)) : foto.url;
    buffer = await fs.readFile(archivo);
  }
  return { inline_data: { mime_type: foto.mime, data: buffer.toString('base64') } };
}

/**
 * Llama a Gemini pidiendo una respuesta JSON con el esquema indicado. Si el modelo principal está saturado (503),
 * sin cuota (429), ya no existe (404) o no responde a tiempo, prueba con los de respaldo en orden. Lanza error si ninguno responde.
 */
async function preguntarGemini(instrucciones: string, partes: object[], esquema: object): Promise<RespuestaGemini> {
  const modelos = [...new Set([config.ia.modelo, ...config.ia.modelosRespaldo])];
  let ultimo: Error | undefined;
  for (const modelo of modelos) {
    try {
      return await llamarModelo(modelo, instrucciones, partes, esquema);
    } catch (e) {
      ultimo = e as Error;
      if (!(e as any).reintentable) throw e;
      console.warn(`[ia] ${modelo} no disponible (${ultimo.message.slice(0, 80)}); probando el siguiente modelo`);
    }
  }
  throw ultimo!;
}

async function llamarModelo(modelo: string, instrucciones: string, partes: object[], esquema: object): Promise<RespuestaGemini> {
  const inicio = Date.now();
  let r: Response;
  try {
    r = await fetch(`${URL_GEMINI}/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': config.ia.geminiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instrucciones }] },
        contents: [{ role: 'user', parts: partes }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: esquema },
      }),
      // Un modelo saturado puede quedarse colgado: tras 12 s se pasa al de respaldo (el usuario espera en el chat)
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e) {
    const lento = (e as Error).name === 'TimeoutError';
    throw Object.assign(new Error(lento ? 'Gemini no respondió en 12 s' : `No se pudo conectar con Gemini: ${(e as Error).message}`), { reintentable: true });
  }
  const cruda = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) {
    const msg = cruda.error?.message ?? `HTTP ${r.status}`;
    const error = new Error(r.status === 429 ? `Se agotó la cuota gratuita de Gemini (${msg})` : msg);
    Object.assign(error, { reintentable: [404, 429, 500, 503].includes(r.status) });
    throw error;
  }
  const texto = (cruda.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  if (!texto) throw new Error(`Gemini no devolvió contenido (${cruda.candidates?.[0]?.finishReason ?? 'sin motivo'})`);
  return {
    datos: JSON.parse(texto),
    modelo: cruda.modelVersion ?? modelo,
    cruda,
    tokensEntrada: cruda.usageMetadata?.promptTokenCount ?? null,
    tokensSalida: cruda.usageMetadata?.candidatesTokenCount ?? null,
    latenciaMs: Date.now() - inicio,
  };
}

const confianza = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0));
/** Texto del error; los de conexión (base apagada) llegan sin mensaje y solo traen el código. */
const motivo = (e: any) => e?.message || (e?.code === 'ECONNREFUSED' ? 'No se pudo conectar con PostgreSQL (¿está iniciado el servicio?)' : e?.code) || String(e);

// =============================================================== Análisis del reporte
export interface AnalisisReporte {
  tipo: 'TEXTO' | 'IMAGEN';
  idCategoria: number | null;
  codigoCategoria: string | null;
  categoria: string | null;
  confianza: number;
  esDanio: boolean;
  /** Solo si hubo foto: false cuando la foto no muestra una instalación o un daño (captura de pantalla, comida, selfie…). */
  fotoValida: boolean | null;
  /** Qué muestra la foto cuando no es válida (ej. "captura de una app de comidas"). */
  motivoFoto: string;
  variables: {
    riesgo_electrico: boolean;
    fuga_activa: boolean;
    riesgo_personas: boolean;
    afecta_clases: boolean;
    personas_afectadas: number | null;
  };
  tipoEquipo: string | null;
  /** Lugar que el reportante mencionó en el texto, ya buscado en la tabla ubicacion (null si no lo dijo). */
  idUbicacion: number | null;
  codigoUbicacion: string | null;
  ubicacion: string | null;
  anomalias: string[];
  titulo: string;
  interpretacion: string;
  modelo: string;
  respuestaCruda: unknown;
  tokensEntrada: number | null;
  tokensSalida: number | null;
  latenciaMs: number;
}

/**
 * Interpreta la descripción (y la foto, si hay) del reporte: categoría, riesgos y, si el texto lo menciona,
 * el lugar (lo busca entre las ubicaciones registradas). Devuelve null si la IA no está disponible.
 */
export async function analizarReporte(descripcion: string, foto?: FotoIa | null): Promise<AnalisisReporte | null> {
  if (!iaActiva()) return null;
  try {
    const cats = await query(`SELECT id_categoria, codigo, nombre, descripcion FROM categoria WHERE activo ORDER BY codigo`);
    const lugares = await query(
      `SELECT u.id_ubicacion, u.codigo, u.nombre, b.nombre AS bloque FROM ubicacion u JOIN bloque b USING (id_bloque) WHERE u.activo ORDER BY u.codigo`,
    );
    const instrucciones =
      'Eres el agente de mantenimiento de una unidad educativa en Ecuador. Analizas reportes de daños enviados por ' +
      'estudiantes, docentes y personal administrativo (texto en español y, a veces, una foto).\n' +
      'Clasifica el daño en UNA de estas categorías (usa el código):\n' +
      cats.map((c) => `- ${c.codigo}: ${c.nombre}${c.descripcion ? ` (${c.descripcion})` : ''}`).join('\n') +
      '\n\nReglas:\n' +
      '- confianza: de 0 a 1, qué tan seguro estás de la categoría. Si la foto y el texto no coinciden o la información es pobre, baja la confianza.\n' +
      '- es_danio: false si el mensaje o la foto no muestran un problema de mantenimiento (saludo, selfie, captura de pantalla, etc.).\n' +
      '- foto_valida (solo si hay foto): true si la foto es una fotografía real de una instalación, mueble, equipo o daño físico; ' +
      'false si es una captura de pantalla, una app, comida, una selfie, un meme, un documento o cualquier cosa ajena al mantenimiento, ' +
      'aunque el texto sí describa un daño. Sin foto, null.\n' +
      '- motivo_foto: si foto_valida es false, qué muestra la foto en pocas palabras (ej. "captura de una app de comidas"); si no, vacío.\n' +
      '- riesgo_electrico: cables expuestos, chispas, olor a quemado, tomacorrientes dañados con riesgo de descarga.\n' +
      '- fuga_activa: agua saliendo en este momento, inundación o goteo constante.\n' +
      '- riesgo_personas: puede lastimar a alguien (vidrios rotos, objetos que pueden caer, pisos resbalosos, estructuras inestables).\n' +
      '- afecta_clases: impide o dificulta dar clases con normalidad en ese lugar.\n' +
      '- personas_afectadas: número aproximado solo si el texto lo indica; si no, null.\n' +
      '- ubicacion: si el TEXTO menciona el lugar, devuelve su código exacto de esta lista (acepta variantes como "aula b 204", "B204", ' +
      '"laboratorio de química"); si no lo menciona o no coincide con ninguno, null. Nunca lo deduzcas de la foto.\n' +
      lugares.map((u) => `  - ${u.codigo}: ${u.nombre} (${u.bloque})`).join('\n') +
      '\n' +
      '- No inventes datos que no estén en el texto o la foto. No decides la prioridad.\n' +
      '- titulo: máximo 6 palabras, describe el daño (ej. "Tomacorriente con chispas").\n' +
      '- interpretacion: 1 o 2 frases en español para el técnico, con lo que se observa. Es un diagnóstico preliminar.';
    const esquema = {
      type: 'OBJECT',
      properties: {
        categoria: { type: 'STRING', enum: cats.map((c) => c.codigo) },
        confianza: { type: 'NUMBER' },
        es_danio: { type: 'BOOLEAN' },
        foto_valida: { type: 'BOOLEAN', nullable: true },
        motivo_foto: { type: 'STRING' },
        riesgo_electrico: { type: 'BOOLEAN' },
        fuga_activa: { type: 'BOOLEAN' },
        riesgo_personas: { type: 'BOOLEAN' },
        afecta_clases: { type: 'BOOLEAN' },
        personas_afectadas: { type: 'INTEGER', nullable: true },
        tipo_equipo: { type: 'STRING', nullable: true },
        ubicacion: { type: 'STRING', nullable: true },
        anomalias: { type: 'ARRAY', items: { type: 'STRING' } },
        titulo: { type: 'STRING' },
        interpretacion: { type: 'STRING' },
      },
      required: ['categoria', 'confianza', 'es_danio', 'riesgo_electrico', 'fuga_activa', 'riesgo_personas', 'afecta_clases', 'anomalias', 'titulo', 'interpretacion'],
    };
    const partes: object[] = [{ text: descripcion ? `Descripción del reporte: "${descripcion}"` : 'El reportante solo envió la foto, sin texto.' }];
    if (foto) partes.push(await parteImagen(foto));

    const r = await preguntarGemini(instrucciones, partes, esquema);
    const d = r.datos;
    const cat = cats.find((c) => c.codigo === d.categoria) ?? null;
    const lugar = lugares.find((u) => u.codigo === String(d.ubicacion ?? '').toUpperCase()) ?? null;
    return {
      tipo: foto ? 'IMAGEN' : 'TEXTO',
      idCategoria: cat?.id_categoria ?? null,
      codigoCategoria: cat?.codigo ?? null,
      categoria: cat?.nombre ?? null,
      confianza: d.es_danio === false ? Math.min(confianza(d.confianza), 0.3) : confianza(d.confianza),
      esDanio: d.es_danio !== false,
      fotoValida: foto ? d.foto_valida !== false : null,
      motivoFoto: foto && d.foto_valida === false ? String(d.motivo_foto ?? '').slice(0, 80) : '',
      variables: {
        riesgo_electrico: !!d.riesgo_electrico,
        fuga_activa: !!d.fuga_activa,
        riesgo_personas: !!d.riesgo_personas,
        afecta_clases: !!d.afecta_clases,
        personas_afectadas: Number.isInteger(d.personas_afectadas) ? d.personas_afectadas : null,
      },
      tipoEquipo: d.tipo_equipo || null,
      idUbicacion: lugar?.id_ubicacion ?? null,
      codigoUbicacion: lugar?.codigo ?? null,
      ubicacion: lugar ? `${lugar.codigo} · ${lugar.nombre}` : null,
      anomalias: Array.isArray(d.anomalias) ? d.anomalias.slice(0, 6).map(String) : [],
      titulo: String(d.titulo ?? '').slice(0, 80),
      interpretacion: String(d.interpretacion ?? ''),
      modelo: r.modelo,
      respuestaCruda: r.cruda,
      tokensEntrada: r.tokensEntrada,
      tokensSalida: r.tokensSalida,
      latenciaMs: r.latenciaMs,
    };
  } catch (e) {
    console.warn('[ia] No se pudo analizar el reporte:', motivo(e));
    return null;
  }
}

/** Guarda un análisis en analisis_ia (evidencia de lo que respondió el modelo) y devuelve su id. */
export async function guardarAnalisis(
  c: pg.PoolClient | null,
  idIncidente: number,
  idEvidencia: number | null,
  a: AnalisisReporte | AnalisisCierre,
) {
  const esReporte = 'variables' in a;
  const sql = `INSERT INTO analisis_ia (id_incidente, id_evidencia, tipo, modelo, version_prompt, id_categoria_sugerida, tipo_equipo_detectado,
                                       confianza, anomalias, variables_riesgo, interpretacion, respuesta_cruda, tokens_entrada, tokens_salida, latencia_ms)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id_analisis`;
  const params = [
    idIncidente,
    idEvidencia,
    a.tipo,
    a.modelo.slice(0, 80),
    VERSION_PROMPT,
    esReporte ? a.idCategoria : null,
    esReporte ? a.tipoEquipo?.slice(0, 80) ?? null : null,
    a.confianza.toFixed(3),
    JSON.stringify(a.anomalias),
    esReporte ? JSON.stringify(a.variables) : JSON.stringify({ solucionado: a.solucionado }),
    a.interpretacion,
    JSON.stringify(a.respuestaCruda),
    a.tokensEntrada,
    a.tokensSalida,
    a.latenciaMs,
  ];
  const { rows } = c ? await c.query(sql, params) : { rows: await query(sql, params) };
  return rows[0].id_analisis as number;
}

// =============================================================== Verificación de la foto de cierre
export interface AnalisisCierre {
  tipo: 'VERIFICACION_CIERRE';
  solucionado: boolean;
  confianza: number;
  anomalias: string[];
  interpretacion: string;
  modelo: string;
  respuestaCruda: unknown;
  tokensEntrada: number | null;
  tokensSalida: number | null;
  latenciaMs: number;
}

/** Compara la foto del reporte (si existe) con la foto de cierre. Devuelve null si la IA no está disponible. */
export async function analizarCierre(descripcion: string, antes: FotoIa | null, despues: FotoIa): Promise<AnalisisCierre | null> {
  if (!iaActiva()) return null;
  try {
    const instrucciones =
      'Eres el agente de mantenimiento de una unidad educativa. Un técnico terminó una reparación y envió la foto de cierre. ' +
      'Decide si el daño reportado se ve resuelto.\n' +
      '- Si hay foto del reporte (ANTES), compárala con la de cierre (DESPUÉS): deben mostrar el mismo lugar u objeto.\n' +
      '- solucionado: true solo si en la foto de cierre ya no se ve el daño descrito.\n' +
      '- confianza: de 0 a 1, qué tan seguro estás de tu respuesta. Baja la confianza si las fotos no parecen del mismo lugar, ' +
      'si la foto está borrosa o si no se alcanza a ver la zona reparada.\n' +
      '- anomalias: problemas que todavía se observan (puede estar vacío).\n' +
      '- interpretacion: 1 o 2 frases en español para el coordinador.';
    const esquema = {
      type: 'OBJECT',
      properties: {
        solucionado: { type: 'BOOLEAN' },
        confianza: { type: 'NUMBER' },
        anomalias: { type: 'ARRAY', items: { type: 'STRING' } },
        interpretacion: { type: 'STRING' },
      },
      required: ['solucionado', 'confianza', 'anomalias', 'interpretacion'],
    };
    const partes: object[] = [{ text: `Daño reportado: "${descripcion}"` }];
    if (antes) partes.push({ text: 'Foto ANTES (reporte):' }, await parteImagen(antes));
    partes.push({ text: 'Foto DESPUÉS (cierre del técnico):' }, await parteImagen(despues));

    const r = await preguntarGemini(instrucciones, partes, esquema);
    return {
      tipo: 'VERIFICACION_CIERRE',
      solucionado: !!r.datos.solucionado,
      confianza: confianza(r.datos.confianza),
      anomalias: Array.isArray(r.datos.anomalias) ? r.datos.anomalias.slice(0, 6).map(String) : [],
      interpretacion: String(r.datos.interpretacion ?? ''),
      modelo: r.modelo,
      respuestaCruda: r.cruda,
      tokensEntrada: r.tokensEntrada,
      tokensSalida: r.tokensSalida,
      latenciaMs: r.latenciaMs,
    };
  } catch (e) {
    console.warn('[ia] No se pudo verificar la foto de cierre:', motivo(e));
    return null;
  }
}
