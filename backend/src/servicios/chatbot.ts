import { iaActiva } from '../config.js';
import { query, queryOne, transaccion } from '../db.js';
import { analizarReporte, guardarAnalisis, parametroNumero, type AnalisisReporte } from './ia.js';
import { asignar } from './asignacion.js';
import { cambiarEstado, crearIncidente, guardarFoto, type Actor } from './incidentes.js';
import { enSegundoPlano } from './segundoPlano.js';
import { cierreAutomatico, verificarCierreConIa } from './verificacion.js';
import { descargarMedia, enviar, obtenerConversacion, type Salida } from './whatsapp.js';

/**
 * Chatbot de WhatsApp (fase 5) con el agente de IA (fase 6).
 * El paso en que va cada persona se guarda en conversacion.estado y conversacion.contexto (JSONB).
 *  - W01 · registro de número nuevo
 *  - W02 · reporte: el agente de IA analiza la foto y el texto apenas llegan (categoría, riesgos y lugar mencionado) y el bot
 *          solo pregunta lo que falta (lugar, foto o, si la IA duda, la categoría). Con todo claro registra directo y asigna.
 *          Sin IA: descripción → ubicación (lista o código/QR) → foto → categoría → riesgo → confirmación.
 *  - W03 · consulta de estado, confirmación de la solución y calificación
 *  - T05 · técnico: recibe avisos informativos (no acepta ni rechaza; atiende desde su panel) y puede enviar la foto de cierre
 *  - Técnico líder: recibe todos los reportes con la asignación del sistema y puede cambiar el técnico
 */

export interface Entrante {
  telefono: string;
  waId: string;
  tipo: 'texto' | 'respuesta' | 'imagen' | 'otro';
  texto?: string; // texto escrito o título del botón pulsado
  idRespuesta?: string; // id del botón o de la fila de lista pulsada
  mediaId?: string;
  caption?: string;
  tipoOriginal?: string;
  payload: unknown;
}

type Contexto = Record<string, any>;
interface Foto {
  url: string;
  mime: string;
  tamano: number;
  hash: string;
  idMensaje: number;
}

const MINUTOS_REINICIO = 120; // un reporte a medias se descarta tras 2 horas sin actividad
const norm = (t = '') => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const SALUDOS = ['hola', 'menu', 'inicio', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'ayuda'];
const ESTRELLAS = ['', '⭐ Malo', '⭐⭐ Regular', '⭐⭐⭐ Bueno', '⭐⭐⭐⭐ Muy bueno', '⭐⭐⭐⭐⭐ Excelente'];

/** Punto de entrada: guarda el mensaje recibido y responde según quién escribe y en qué paso está. */
export async function procesarEntrante(m: Entrante) {
  const usuario = await queryOne(
    `SELECT u.id_usuario, u.id_rol, u.nombres, u.apellidos, u.activo, r.codigo AS rol, t.id_tecnico, t.es_lider
       FROM usuario u JOIN rol r USING (id_rol) LEFT JOIN tecnico t USING (id_usuario)
      WHERE u.telefono_wa = $1`,
    [m.telefono],
  );
  const conv = await obtenerConversacion(m.telefono, usuario?.id_usuario ?? null);
  const inactivoDesde = Date.now() - new Date(conv.ultima_actividad).getTime();

  // Registro del mensaje (idempotente: Meta puede reenviar el mismo webhook)
  const tipoBd = { texto: 'TEXTO', respuesta: 'INTERACTIVO', imagen: 'IMAGEN', otro: m.tipoOriginal === 'audio' ? 'AUDIO' : m.tipoOriginal === 'location' ? 'UBICACION' : 'TEXTO' }[m.tipo];
  const contenido = m.tipo === 'imagen' ? m.caption || '[Foto]' : m.texto ?? `[${m.tipoOriginal ?? 'mensaje'}]`;
  const guardado = await queryOne(
    `INSERT INTO mensaje (id_conversacion, wa_message_id, direccion, tipo, contenido, media_id, payload, estado)
     VALUES ($1, $2, 'ENTRANTE', $3, $4, $5, $6, 'RECIBIDO')
     ON CONFLICT (wa_message_id) DO NOTHING RETURNING id_mensaje`,
    [conv.id_conversacion, m.waId, tipoBd, contenido, m.mediaId ?? null, JSON.stringify(m.payload)],
  );
  if (!guardado) return; // duplicado: ya se procesó
  await query(`UPDATE conversacion SET ultima_actividad = now() WHERE id_conversacion = $1`, [conv.id_conversacion]);

  // La foto se descarga al recibirla: queda como evidencia y se ve en la pantalla Conversaciones
  let foto: Foto | null = null;
  if (m.tipo === 'imagen' && m.mediaId) {
    try {
      const { buffer, mime } = await descargarMedia(m.mediaId);
      const maxMb = Number((await queryOne(`SELECT valor FROM parametro_sistema WHERE clave = 'archivo.max_mb'`))?.valor ?? 5);
      if (buffer.length <= maxMb * 1024 * 1024) {
        const g = await guardarFoto(buffer, mime.split(';')[0], 'WA');
        await query(`UPDATE mensaje SET media_url = $2 WHERE id_mensaje = $1`, [guardado.id_mensaje, g.url]);
        foto = { ...g, mime: mime.split(';')[0], idMensaje: guardado.id_mensaje };
      }
    } catch (e) {
      console.warn('[chatbot] No se pudo descargar la foto:', (e as Error).message);
    }
  }

  const ctx: Contexto = conv.contexto ?? {};
  // El coordinador tomó la conversación desde el panel: el bot no interviene durante 30 minutos
  if (ctx.manual_hasta && new Date(ctx.manual_hasta).getTime() > Date.now()) return;

  const s = new Sesion(m.telefono, conv.id_conversacion, conv.estado, ctx, usuario);
  if (s.estado !== 'INICIO' && s.estado !== 'FINALIZADA' && inactivoDesde > MINUTOS_REINICIO * 60_000) {
    await s.guardar('INICIO', {});
  }

  try {
    if (m.tipo === 'otro') return await s.decir('Por ahora entiendo mensajes de texto, botones y fotos 🙂. Escribe *menu* para ver las opciones.');
    if (!usuario) return await registro(s, m);
    if (!usuario.activo) return await s.decir('Tu número está desactivado en el sistema de mantenimiento. Acércate a coordinación para reactivarlo.');
    if (usuario.rol === 'TECNICO') return await tecnico(s, m, foto);
    if (usuario.rol === 'ADMIN') return await s.decir('Hola 👋 Este número es para reportes de la comunidad. Gestiona los incidentes desde el panel web del SGIM.');
    return await comunidad(s, m, foto);
  } catch (e) {
    console.error('[chatbot] Error procesando mensaje:', e);
    await s.decir('Tuve un problema procesando tu mensaje 😕. Intenta de nuevo en un momento o escribe *menu*.');
  }
}

/** Estado de la conversación con atajos para responder y avanzar de paso. */
class Sesion {
  constructor(
    public telefono: string,
    public idConversacion: number,
    public estado: string,
    public ctx: Contexto,
    public usuario: any,
  ) {}

  enviar(s: Salida) {
    return enviar(this.telefono, s, this.idConversacion);
  }
  decir(texto: string) {
    return this.enviar({ tipo: 'texto', texto });
  }
  async guardar(estado: string, ctx: Contexto) {
    this.estado = estado;
    this.ctx = ctx;
    await query(`UPDATE conversacion SET estado = $2, contexto = $3 WHERE id_conversacion = $1`, [this.idConversacion, estado, JSON.stringify(ctx)]);
  }
  get actor(): Actor {
    return { idUsuario: this.usuario.id_usuario, idRol: this.usuario.id_rol, rol: this.usuario.rol };
  }
}

// =============================================================== W01 · registro de número nuevo
/** Palabras que no son nombres: si aparecen, la persona respondió otra cosa ("no quiero", "hola", "qué es esto"…). */
const NO_NOMBRES = new Set(
  ('no si sí quiero quero hola ola ok okay gracias que qué como cómo porque por para nada ninguno ninguna tengo ' +
    'soy es esto eso este esta yo tu tú mi el la los las un una de del y o ah eh jaja jajaja xd bot menu menú ayuda ' +
    'buenas buenos dias días tardes noches test prueba probando nombre apellido daño reporte aula estudiante docente ' +
    'administrativo hey hi hello bien mal claro vale listo sale dale cancelar salir').split(' '),
);
const capitalizar = (p: string) => p.charAt(0).toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es');

/** Devuelve nombres y apellidos si el texto parece un nombre real (2 a 5 palabras, solo letras, sin palabras comunes). */
function nombreValido(texto: string) {
  const partes = texto.trim().replace(/\s+/g, ' ').split(' ');
  if (partes.length < 2 || partes.length > 5) return null;
  if (partes.some((p) => !/^[\p{L}'-]{2,20}$/u.test(p) || NO_NOMBRES.has(norm(p)))) return null;
  const limpias = partes.map(capitalizar);
  const mitad = limpias.length >= 4 ? 2 : 1;
  return { nombres: limpias.slice(0, mitad).join(' '), apellidos: limpias.slice(mitad).join(' ') };
}

const listaTipoMiembro = (texto: string): Salida => ({
  tipo: 'lista',
  texto,
  boton: 'Elegir',
  filas: [
    { id: 'reg:tipo:ESTUDIANTE', titulo: 'Estudiante' },
    { id: 'reg:tipo:DOCENTE', titulo: 'Docente' },
    { id: 'reg:tipo:ADMINISTRATIVO', titulo: 'Personal administrativo', descripcion: 'Secretaría, colecturía, inspección, conserjería' },
  ],
});

async function registro(s: Sesion, m: Entrante) {
  if (s.ctx.paso === 'reg_nombre' && m.tipo === 'texto') {
    const nombre = nombreValido(m.texto ?? '');
    if (!nombre) {
      return s.decir('Para registrarte necesito tu *nombre y apellido* reales, por ejemplo: _María Torres_.\nSolo letras, sin números ni otras frases.');
    }
    await s.guardar('INICIO', { paso: 'reg_confirma', ...nombre });
    return s.enviar({
      tipo: 'botones',
      texto: `¿Te registro como *${nombre.nombres} ${nombre.apellidos}*?`,
      botones: [
        { id: 'reg:nombre:si', titulo: 'Sí, es correcto' },
        { id: 'reg:nombre:no', titulo: 'Corregir' },
      ],
    });
  }
  if (s.ctx.paso === 'reg_confirma') {
    if (m.idRespuesta === 'reg:nombre:si') {
      await s.guardar('INICIO', { ...s.ctx, paso: 'reg_tipo' });
      return s.enviar(listaTipoMiembro(`Gracias, ${s.ctx.nombres}. ¿Qué eres en la unidad educativa?`));
    }
    await s.guardar('INICIO', { paso: 'reg_nombre' });
    return s.decir('De acuerdo. Escribe tu *nombre y apellido*, por ejemplo: _María Torres_.');
  }
  if (s.ctx.paso === 'reg_tipo' && m.idRespuesta?.startsWith('reg:tipo:')) {
    const tipo = m.idRespuesta.split(':')[2];
    const u = await queryOne(
      `INSERT INTO usuario (id_rol, nombres, apellidos, telefono_wa, tipo_miembro, debe_cambiar_pwd)
       VALUES ((SELECT id_rol FROM rol WHERE codigo = 'COMUNIDAD'), $1, $2, $3, $4, FALSE)
       ON CONFLICT (telefono_wa) DO UPDATE SET nombres = usuario.nombres
       RETURNING id_usuario, id_rol, nombres`,
      [s.ctx.nombres, s.ctx.apellidos, s.telefono, tipo],
    );
    await query(`UPDATE conversacion SET id_usuario = $2 WHERE id_conversacion = $1`, [s.idConversacion, u!.id_usuario]);
    await query(`INSERT INTO auditoria (id_usuario, accion, entidad, id_entidad, datos_nuevos) VALUES ($1, 'CREAR', 'usuario', $2, $3)`, [
      u!.id_usuario,
      String(u!.id_usuario),
      JSON.stringify({ canal: 'WHATSAPP', tipo_miembro: tipo }),
    ]);
    await s.guardar('INICIO', {});
    await s.decir(`¡Listo, ${u!.nombres}! Ya estás registrado ✅`);
    return menu(s, u!.nombres);
  }
  if (s.ctx.paso === 'reg_tipo') return s.enviar(listaTipoMiembro('Elige una opción de la lista:'));
  const bienvenida = (await queryOne(`SELECT valor FROM parametro_sistema WHERE clave = 'wa.mensaje_bienvenida'`))?.valor;
  await s.guardar('INICIO', { paso: 'reg_nombre' });
  return s.decir(`${bienvenida ?? 'Hola 👋 Soy el asistente de mantenimiento.'}\n\nComo es la primera vez que escribes, dime tu *nombre y apellido*.`);
}

function menu(s: Sesion, nombre?: string) {
  return s.enviar({
    tipo: 'botones',
    texto: `${nombre ? `Hola ${nombre} 👋 ` : ''}¿Qué necesitas?`,
    botones: [
      { id: 'menu:reportar', titulo: 'Reportar un daño' },
      { id: 'menu:estado', titulo: 'Mis reportes' },
    ],
  });
}

// =============================================================== Comunidad educativa
async function comunidad(s: Sesion, m: Entrante, foto: Foto | null) {
  const t = norm(m.texto);
  const id = m.idRespuesta ?? '';

  // Respuestas a avisos (pueden llegar en cualquier momento)
  if (id.startsWith('conf:')) return confirmarSolucion(s, id);
  if (id.startsWith('cal:')) return calificar(s, id);
  // Comandos globales
  if (t === 'cancelar') {
    await s.guardar('INICIO', {});
    await s.decir('Listo, cancelé lo que estábamos haciendo.');
    return menu(s);
  }
  if (id === 'menu:estado' || t === 'estado' || t === 'mis reportes') return consultar(s);
  if (id === 'menu:reportar' || t === 'reportar') return iniciarReporte(s);
  if (s.estado === 'CONSULTA' && s.ctx.paso === 'motivo_no' && m.tipo === 'texto') return noSolucionado(s, m.texto!);

  switch (s.estado) {
    case 'ESPERANDO_DESCRIPCION':
      return pasoDescripcion(s, m, foto);
    case 'ESPERANDO_UBICACION':
      return pasoUbicacion(s, m);
    case 'ESPERANDO_FOTO':
      return pasoFoto(s, m, foto);
    case 'CONFIRMANDO':
      return pasoConfirmando(s, m);
    default:
      // Una foto o un texto largo sin menú previo se toman como el inicio de un reporte
      if (foto || (m.tipo === 'texto' && !SALUDOS.includes(t) && (m.texto ?? '').length >= 15)) {
        await s.guardar('ESPERANDO_DESCRIPCION', { rep: {} });
        return pasoDescripcion(s, m, foto);
      }
      return menu(s, s.usuario.nombres);
  }
}

async function iniciarReporte(s: Sesion) {
  await s.guardar('ESPERANDO_DESCRIPCION', { rep: {} });
  return s.decir(
    'Cuéntame qué daño encontraste 📝\nEnvía una foto y, si puedes, dime en el mismo mensaje *qué pasa* y *dónde* (por ejemplo: _el interruptor hace corto en el aula B-204_).\n\n' +
      '_Escribe *cancelar* en cualquier momento para salir._',
  );
}

async function pasoDescripcion(s: Sesion, m: Entrante, foto: Foto | null) {
  const rep = { ...(s.ctx.rep ?? {}) };
  if (foto) rep.foto = foto;
  const texto = (m.tipo === 'imagen' ? m.caption : m.texto)?.trim() ?? '';
  if (texto.length >= 5) rep.descripcion = rep.descripcion && !rep.descripcionIa ? `${rep.descripcion}\n${texto}` : texto;
  if (texto.length >= 5) rep.descripcionIa = false;
  return avanzarReporte(s, rep, true);
}

const datosLugar = (u: { id_ubicacion: number; codigo: string; nombre: string }) => ({
  idUbicacion: u.id_ubicacion,
  ubicacion: `${u.codigo} · ${u.nombre}`,
  codigoUbicacion: u.codigo,
  ubicacionTexto: null,
});

/** Busca un código de lugar escrito en el texto (B-204, b 204, B204), aunque la IA no esté disponible. */
async function ubicacionEnTexto(texto: string) {
  for (const m of texto.matchAll(/\b([a-z])\s*-?\s*(\d{3}|\d[a-z]{2})\b/gi)) {
    const u = await buscarUbicacion(`${m[1]}-${m[2]}`);
    if (u) return u;
  }
  return null;
}

/**
 * Decide el siguiente paso con lo que ya se sabe: el bot solo pregunta lo que falta.
 * Con IA, la foto y el texto se analizan apenas llegan (categoría, riesgos y lugar mencionado) y, si el agente
 * está seguro y conoce el lugar, el reporte se registra directo y se asigna al técnico, sin más preguntas.
 */
async function avanzarReporte(s: Sesion, rep: Contexto, reanalizar = false) {
  const umbral = await parametroNumero('ia.umbral_confianza', 0.7);
  if (!rep.idUbicacion && !rep.ubicacionTexto && rep.descripcion) {
    const u = await ubicacionEnTexto(rep.descripcion);
    if (u) Object.assign(rep, datosLugar(u));
  }
  if (iaActiva() && (rep.descripcion || rep.foto) && (reanalizar || !rep.ia)) {
    if (!rep.ia) await s.decir('🤖 Analizando tu reporte…');
    let a = await analizarReporte(rep.descripcionIa ? '' : rep.descripcion ?? '', rep.foto ? { url: rep.foto.url, mime: rep.foto.mime } : null);
    // Foto ajena al mantenimiento (captura de pantalla, comida, selfie…): se avisa, se descarta y no queda como evidencia
    if (a && rep.foto && a.fotoValida === false) {
      await s.decir(
        `⚠️ La foto no parece mostrar un daño de mantenimiento${a.motivoFoto ? ` (parece ${a.motivoFoto})` : ''}, así que no la usaré en el reporte.`,
      );
      delete rep.foto;
      rep.fotoRechazada = true;
      if (rep.descripcionIa) Object.assign(rep, { descripcion: null, descripcionIa: false });
      a = rep.descripcion ? await analizarReporte(rep.descripcion, null) : null;
      if (!a) delete rep.ia;
    }
    if (a) {
      rep.ia = a;
      if (!rep.idUbicacion && a.idUbicacion) Object.assign(rep, { idUbicacion: a.idUbicacion, ubicacion: a.ubicacion, codigoUbicacion: a.codigoUbicacion, ubicacionTexto: null });
      // Solo foto: si el agente ve el daño con claridad, lo que ve sirve como descripción; si duda, se le pregunta al reportante
      // (así nunca queda registrada una descripción inventada)
      const seguro = a.esDanio && a.confianza >= umbral && !!(a.interpretacion || a.titulo);
      if ((!rep.descripcion || rep.descripcionIa) && seguro) Object.assign(rep, { descripcion: a.interpretacion || a.titulo, descripcionIa: true });
      if (rep.descripcionIa && !seguro) Object.assign(rep, { descripcion: null, descripcionIa: false });
    }
  }

  if (!rep.descripcion) {
    await s.guardar('ESPERANDO_DESCRIPCION', { rep });
    if (rep.fotoRechazada && !rep.foto) return s.decir('Envíame una *foto real del daño* o descríbeme el problema y dónde está.');
    return s.decir(rep.foto ? 'Recibí la foto 📷. Ahora descríbeme brevemente el problema.' : 'Descríbeme el problema con un poco más de detalle, por favor.');
  }
  if (!rep.idUbicacion && !rep.ubicacionTexto) return pedirUbicacion(s, rep);
  if (!rep.foto && !rep.sinFoto) {
    await s.guardar('ESPERANDO_FOTO', { rep });
    return s.enviar({
      tipo: 'botones',
      texto: rep.fotoRechazada
        ? '📷 Envía una *foto real del daño* (no capturas de pantalla). Si no puedes, pulsa Omitir.'
        : '📷 Envía una foto del daño. Ayuda al técnico a llegar preparado.',
      botones: [{ id: 'rep:omitir_foto', titulo: 'Omitir foto' }],
    });
  }
  if (!rep.ia) return pedirCategoria(s, rep); // sin IA: flujo guiado con botones
  if (!rep.categoriaManual) {
    if (!rep.ia.idCategoria || rep.ia.confianza < umbral) {
      // Primero se pide que cuente qué pasa (una vez) y se vuelve a analizar; si aún duda, se pregunta la categoría
      if (!rep.pidioDetalle) {
        await s.guardar('ESPERANDO_DESCRIPCION', { rep: { ...rep, pidioDetalle: true } });
        return s.decir('No alcanzo a distinguir bien el daño 🤔. Cuéntame en pocas palabras *qué pasa* (por ejemplo: _entra agua por la ventana cuando llueve_).');
      }
      await s.decir('Sigo sin estar seguro del tipo de daño. Ayúdame eligiéndolo:');
      return pedirCategoria(s, rep);
    }
    Object.assign(rep, { idCategoria: rep.ia.idCategoria, categoria: rep.ia.categoria, codigoCategoria: rep.ia.codigoCategoria });
  }
  return registrarReporte(s, rep);
}

async function pedirUbicacion(s: Sesion, rep: Contexto) {
  await s.guardar('ESPERANDO_UBICACION', { rep });
  const bloques = await query(`SELECT id_bloque, codigo, nombre FROM bloque WHERE activo ORDER BY codigo`);
  // Solo se muestra lo que entendió la IA si está segura (si duda, su título podría ser incorrecto)
  const seguro = rep.ia?.categoria && rep.ia.esDanio && rep.ia.confianza >= (await parametroNumero('ia.umbral_confianza', 0.7));
  const entendi = seguro ? `Entendí: 🏷️ *${rep.ia.categoria}*${rep.ia.titulo ? ` · ${rep.ia.titulo}` : ''}.\n\n` : '';
  return s.enviar({
    tipo: 'lista',
    texto: `${entendi}📍 ¿Dónde está el daño?\nEscribe el código del lugar (por ejemplo *B-204*), el código del QR pegado en la puerta, o elige el bloque:`,
    boton: 'Elegir bloque',
    filas: bloques.map((b) => ({ id: `rep:bloque:${b.id_bloque}`, titulo: b.nombre, descripcion: `Bloque ${b.codigo}` })),
  });
}

/** Busca la ubicación por su código (con o sin guion) o por el código del QR. */
async function buscarUbicacion(texto: string) {
  const c = texto.toUpperCase().replace(/\s+/g, '');
  return queryOne(
    `SELECT id_ubicacion, codigo, nombre FROM ubicacion
      WHERE activo AND (codigo = $1 OR replace(codigo, '-', '') = replace($1, '-', '') OR codigo_qr = $1 OR codigo_qr = 'QR-' || replace($1, '-', ''))
      LIMIT 1`,
    [c],
  );
}

/** ¿El texto es idéntico a lo que ya mandó como descripción? (reenvío mientras el agente analizaba) */
const esRepetido = (rep: Contexto, texto: string) =>
  !!rep.descripcion && !rep.descripcionIa && String(rep.descripcion).split('\n').some((l) => norm(l) === norm(texto));

async function pasoUbicacion(s: Sesion, m: Entrante) {
  const rep = { ...s.ctx.rep };
  const id = m.idRespuesta ?? '';
  if (id.startsWith('rep:bloque:')) {
    const ubic = await query(
      `SELECT id_ubicacion, codigo, nombre FROM ubicacion WHERE activo AND id_bloque = $1 ORDER BY codigo LIMIT 10`,
      [Number(id.split(':')[2])],
    );
    if (!ubic.length) return s.decir('Ese bloque aún no tiene lugares registrados. Escribe el nombre del lugar y coordinación lo revisará.');
    return s.enviar({
      tipo: 'lista',
      texto: 'Elige el lugar. Si no aparece en la lista, escribe su código o su nombre.',
      boton: 'Elegir lugar',
      filas: ubic.map((u) => ({ id: `rep:ubic:${u.id_ubicacion}`, titulo: u.codigo, descripcion: u.nombre })),
    });
  }
  if (id.startsWith('rep:ubic:')) {
    const u = await queryOne(`SELECT id_ubicacion, codigo, nombre FROM ubicacion WHERE id_ubicacion = $1`, [Number(id.split(':')[2])]);
    if (!u) return pedirUbicacion(s, rep);
    return avanzarReporte(s, { ...rep, ...datosLugar(u) });
  }
  if (m.tipo === 'texto' && (m.texto ?? '').trim().length >= 2) {
    const texto = m.texto!.trim();
    const u = (await buscarUbicacion(texto)) ?? (await ubicacionEnTexto(texto));
    if (u) return avanzarReporte(s, { ...rep, ...datosLugar(u) });
    // Mensaje repetido o escrito mientras el agente analizaba (la gente suele reenviar el reporte): no es el lugar.
    // Se vuelve a preguntar en vez de guardar la descripción como «lugar no reconocido» (hallado en la prueba de 10 personas a la vez).
    // Solo cuenta como repetido el mismo texto exacto (un lugar escrito en palabras sí puede aparecer dentro de la descripción).
    if (esRepetido(rep, texto)) {
      if (rep.avisoRepetido) return; // ya se le pidió el lugar: los reenvíos idénticos se ignoran (sin bucles)
      await s.guardar('ESPERANDO_UBICACION', { rep: { ...rep, avisoRepetido: true } });
      return s.decir('Ya tengo la descripción del daño 👍. Ahora dime *en qué lugar* está: el código (por ejemplo *B-204*) o el nombre (por ejemplo _laboratorio de química_).');
    }
    // Nombre del lugar en palabras ("laboratorio de química"): el agente lo busca entre las ubicaciones registradas
    const a = iaActiva()
      ? await analizarReporte(`${rep.descripcionIa ? '' : rep.descripcion ?? ''}\nLugar indicado por el reportante: ${texto}`, rep.foto ? { url: rep.foto.url, mime: rep.foto.mime } : null)
      : null;
    if (a?.idUbicacion) return avanzarReporte(s, { ...rep, ia: a, idUbicacion: a.idUbicacion, ubicacion: a.ubicacion, codigoUbicacion: a.codigoUbicacion, ubicacionTexto: null });
    // Texto largo sin un lugar reconocible: probablemente es más detalle del daño. Se suma a la descripción y se pregunta
    // el lugar una vez más; si vuelve a escribir algo que no se reconoce, se registra tal cual para revisión manual.
    if (texto.length > 60 && !rep.repreguntoLugar) {
      const descripcion = rep.descripcionIa || !rep.descripcion ? texto : `${rep.descripcion}\n${texto}`;
      await s.guardar('ESPERANDO_UBICACION', { rep: { ...rep, descripcion, descripcionIa: false, repreguntoLugar: true } });
      return s.decir('Anoté ese detalle del daño 📝. ¿*En qué lugar* está? Escribe el código (por ejemplo *B-204*) o el nombre del lugar.');
    }
    await s.decir('No encontré ese lugar en el sistema. Lo registraré tal como lo escribiste y coordinación lo revisará 👍');
    return avanzarReporte(s, { ...rep, idUbicacion: null, ubicacionTexto: texto.slice(0, 255), ubicacion: texto });
  }
  return pedirUbicacion(s, rep);
}

async function pasoFoto(s: Sesion, m: Entrante, foto: Foto | null) {
  const rep = { ...s.ctx.rep };
  if (foto) return avanzarReporte(s, { ...rep, foto }, true); // con la foto el agente vuelve a analizar
  if (m.tipo === 'imagen') return s.decir('No pude recibir la foto 😕. Intenta enviarla de nuevo o pulsa *Omitir foto*.');
  if (m.idRespuesta === 'rep:omitir_foto' || norm(m.texto) === 'omitir') return avanzarReporte(s, { ...rep, sinFoto: true });
  // Reenvío idéntico del reporte mientras se analizaba: ya se le pidió la foto, no se repite el mensaje
  if (m.tipo === 'texto' && m.texto && esRepetido(rep, m.texto)) return;
  // Si el lugar quedó sin reconocer y ahora escribe un código válido (A-202, B 204), se corrige el lugar
  if (m.tipo === 'texto' && !rep.idUbicacion && m.texto) {
    const u = (await buscarUbicacion(m.texto.trim())) ?? (await ubicacionEnTexto(m.texto));
    if (u) {
      await s.guardar('ESPERANDO_FOTO', { rep: { ...rep, ...datosLugar(u) } });
      return s.enviar({ tipo: 'botones', texto: `📍 Anotado: *${u.codigo} · ${u.nombre}*.\n\nAhora envía una foto del daño o pulsa *Omitir foto*.`, botones: [{ id: 'rep:omitir_foto', titulo: 'Omitir foto' }] });
    }
  }
  return s.enviar({ tipo: 'botones', texto: 'Envía una foto o pulsa *Omitir foto*.', botones: [{ id: 'rep:omitir_foto', titulo: 'Omitir foto' }] });
}

async function pedirCategoria(s: Sesion, rep: Contexto) {
  await s.guardar('CONFIRMANDO', { rep, paso: 'categoria' });
  const cats = await query(`SELECT id_categoria, nombre, descripcion FROM categoria WHERE activo ORDER BY nombre`);
  return s.enviar({
    tipo: 'lista',
    texto: '🏷️ ¿De qué tipo es el daño?',
    boton: 'Elegir tipo',
    filas: cats.map((c) => ({ id: `rep:cat:${c.id_categoria}`, titulo: c.nombre, descripcion: c.descripcion ?? undefined })),
  });
}

const PREGUNTA_PELIGRO: Record<string, string> = {
  ELEC: '⚠️ ¿Hay cables expuestos, chispas u olor a quemado?',
  AGUA: '⚠️ ¿El agua está saliendo ahora (fuga activa o inundación)?',
};
const siNo = (prefijo: string) => [
  { id: `${prefijo}:si`, titulo: 'Sí' },
  { id: `${prefijo}:no`, titulo: 'No' },
];

async function pasoConfirmando(s: Sesion, m: Entrante) {
  const rep = { ...s.ctx.rep };
  const id = m.idRespuesta ?? '';
  const paso = s.ctx.paso;

  if (paso === 'categoria' && id.startsWith('rep:cat:')) {
    const c = await queryOne(`SELECT id_categoria, codigo, nombre FROM categoria WHERE id_categoria = $1`, [Number(id.split(':')[2])]);
    if (!c) return pedirCategoria(s, rep);
    Object.assign(rep, { idCategoria: c.id_categoria, categoria: c.nombre, codigoCategoria: c.codigo, categoriaManual: true });
    // Si se llegó aquí el agente dudó: sus variables de riesgo no se usan y se pregunta el peligro con botones
    await s.guardar('CONFIRMANDO', { rep, paso: 'peligro' });
    return s.enviar({ tipo: 'botones', texto: PREGUNTA_PELIGRO[c.codigo] ?? '⚠️ ¿El daño representa peligro para las personas?', botones: siNo('rep:peligro') });
  }
  if (paso === 'peligro' && id.startsWith('rep:peligro:')) {
    rep.peligro = id.endsWith(':si');
    await s.guardar('CONFIRMANDO', { rep, paso: 'clases' });
    return s.enviar({ tipo: 'botones', texto: '📚 ¿El daño impide dar clases con normalidad?', botones: siNo('rep:clases') });
  }
  if (paso === 'clases' && id.startsWith('rep:clases:')) {
    rep.afectaClases = id.endsWith(':si');
    if (rep.ia) return registrarReporte(s, rep); // con IA se registra directo, como en el resto del flujo
    await s.guardar('CONFIRMANDO', { rep, paso: 'confirmar' });
    return s.enviar({
      tipo: 'botones',
      texto:
        `Revisa tu reporte:\n\n📝 ${rep.descripcion}\n📍 ${rep.ubicacion}\n🏷️ ${rep.categoria}\n📷 Foto: ${rep.foto ? 'sí' : 'no'}\n` +
        `⚠️ Peligro: ${rep.peligro ? 'sí' : 'no'} · Impide clases: ${rep.afectaClases ? 'sí' : 'no'}\n\n¿Lo envío?`,
      botones: [
        { id: 'rep:confirmar', titulo: 'Enviar reporte' },
        { id: 'rep:cancelar', titulo: 'Cancelar' },
      ],
    });
  }
  if (paso === 'confirmar' && id === 'rep:confirmar') return registrarReporte(s, rep);
  if (id === 'rep:cancelar') {
    await s.guardar('INICIO', {});
    await s.decir('Cancelé el reporte. No se registró nada.');
    return menu(s);
  }
  // Respuesta inesperada: se repite la pregunta del paso actual
  if (paso === 'categoria') return pedirCategoria(s, rep);
  if (paso === 'peligro') return s.enviar({ tipo: 'botones', texto: 'Responde con los botones, por favor:', botones: siNo('rep:peligro') });
  if (paso === 'clases') return s.enviar({ tipo: 'botones', texto: 'Responde con los botones, por favor:', botones: siNo('rep:clases') });
  return s.enviar({
    tipo: 'botones',
    texto: '¿Envío el reporte?',
    botones: [
      { id: 'rep:confirmar', titulo: 'Enviar reporte' },
      { id: 'rep:cancelar', titulo: 'Cancelar' },
    ],
  });
}

async function registrarReporte(s: Sesion, rep: Contexto) {
  const ia: AnalisisReporte | undefined = rep.ia;
  // Si el agente estaba seguro, las variables de riesgo vienen de él; si dudó (categoría elegida a mano) o no hay IA,
  // la respuesta de "peligro" alimenta la variable que corresponde a la categoría.
  const riesgo =
    ia && !rep.categoriaManual
      ? { ...ia.variables }
      : {
          riesgo_electrico: rep.peligro && rep.codigoCategoria === 'ELEC',
          fuga_activa: rep.peligro && rep.codigoCategoria === 'AGUA',
          riesgo_personas: rep.peligro && !['ELEC', 'AGUA'].includes(rep.codigoCategoria),
          afecta_clases: rep.afectaClases,
        };
  const lugar = rep.codigoUbicacion ?? rep.ubicacionTexto ?? '';
  const titulo = ia?.titulo && !rep.categoriaManual ? ia.titulo : rep.categoria;
  const inc = await transaccion({ ...ctxTransaccion(s), comentario: 'Reportado por WhatsApp' }, async (c) => {
    const creado = await crearIncidente(c, {
      idReportante: s.usuario.id_usuario,
      canal: 'WHATSAPP',
      idConversacion: s.idConversacion,
      titulo: `${titulo} · ${lugar}`.slice(0, 150),
      descripcion: rep.descripcion,
      idUbicacion: rep.idUbicacion ?? null,
      ubicacionTexto: rep.idUbicacion ? null : rep.ubicacionTexto,
      idCategoria: rep.idCategoria,
      ...riesgo,
    });
    let idEvidencia: number | null = null;
    if (rep.foto) {
      const { rows } = await c.query(
        `INSERT INTO evidencia (id_incidente, id_mensaje, id_subido_por, tipo, url_archivo, mime_type, tamano_bytes, hash_sha256, descripcion)
         VALUES ($1, $2, $3, 'REPORTE', $4, $5, $6, $7, 'Foto enviada por WhatsApp') RETURNING id_evidencia`,
        [creado.id_incidente, rep.foto.idMensaje, s.usuario.id_usuario, rep.foto.url, rep.foto.mime, rep.foto.tamano, rep.foto.hash],
      );
      idEvidencia = rows[0].id_evidencia;
    }
    if (ia) {
      // Queda como evidencia de lo que sugirió el agente; si la confianza es baja, el caso aparece en revisión manual
      await guardarAnalisis(c, creado.id_incidente, ia.tipo === 'IMAGEN' ? idEvidencia : null, ia);
      await c.query(`UPDATE incidente SET diagnostico_preliminar = $2 WHERE id_incidente = $1`, [creado.id_incidente, ia.interpretacion || null]);
    }
    return creado;
  });
  await s.guardar('FINALIZADA', {});
  const prioridad = ({ ALTA: 'Alta 🔴', MEDIA: 'Media 🟠', BAJA: 'Baja 🟢' } as Record<string, string>)[inc.prioridad] ?? inc.prioridad;
  const riesgos = [riesgo.riesgo_electrico && 'riesgo eléctrico', riesgo.fuga_activa && 'fuga activa', riesgo.riesgo_personas && 'riesgo para las personas'].filter(Boolean);
  return s.decir(
    `✅ ¡Listo! Registré tu reporte *${inc.codigo}*\n\n🏷️ ${rep.categoria}${titulo !== rep.categoria ? ` · ${titulo}` : ''}\n📍 ${rep.ubicacion}\n` +
      (riesgos.length ? `⚠️ ${riesgos.join(', ')}\n` : '') +
      `Prioridad: ${prioridad}\n\n` +
      (inc.tecnico
        ? `Lo atenderá *${inc.tecnico}*.`
        : rep.idUbicacion
          ? 'Coordinación lo asignará a un técnico en breve.'
          : 'Coordinación revisará el lugar y lo asignará a un técnico.') +
      '\n\nTe avisaré por aquí cuando cambie de estado. Escribe *estado* para consultarlo cuando quieras.',
  );
}

const ctxTransaccion = (s: Sesion) => ({ idUsuario: s.usuario.id_usuario, idRol: s.usuario.id_rol, canal: 'WHATSAPP' as const });

// =============================================================== W03 · consulta, confirmación y calificación
async function consultar(s: Sesion) {
  await s.guardar('INICIO', {});
  const filas = await query(
    `SELECT i.id_incidente, i.codigo, i.titulo, e.codigo AS estado, e.visible_usuario,
            (SELECT v.confirmacion_reportante FROM verificacion_cierre v WHERE v.id_incidente = i.id_incidente ORDER BY v.creado_en DESC LIMIT 1) AS confirmado
       FROM incidente i JOIN estado_incidente e USING (id_estado)
      WHERE i.id_reportante = $1 AND (NOT e.es_final OR i.fecha_cierre > now() - interval '7 days')
      ORDER BY i.fecha_reporte DESC LIMIT 5`,
    [s.usuario.id_usuario],
  );
  if (!filas.length) {
    await s.decir('No tienes reportes abiertos en este momento 👍');
    return menu(s);
  }
  await s.decir(`📋 *Tus reportes*\n\n${filas.map((f) => `• *${f.codigo}* · ${f.titulo}\n   ${f.visible_usuario}`).join('\n\n')}`);
  const porConfirmar = filas.find((f) => f.estado === 'EN_VERIFICACION' && f.confirmado == null);
  if (porConfirmar) return preguntarSolucion(s, porConfirmar.id_incidente, porConfirmar.codigo);
}

export function botonesSolucion(idIncidente: number) {
  return [
    { id: `conf:si:${idIncidente}`, titulo: 'Sí, quedó bien' },
    { id: `conf:no:${idIncidente}`, titulo: 'No, sigue el daño' },
  ];
}

function preguntarSolucion(s: Sesion, idIncidente: number, codigo: string) {
  return s.enviar({ tipo: 'botones', texto: `🔧 El técnico terminó el trabajo de *${codigo}*. ¿Quedó solucionado?`, botones: botonesSolucion(idIncidente) });
}

export function listaCalificacion(idIncidente: number, codigo: string): Salida {
  return {
    tipo: 'lista',
    texto: `¿Cómo calificas la atención de *${codigo}*?`,
    boton: 'Calificar',
    filas: [5, 4, 3, 2, 1].map((n) => ({ id: `cal:${idIncidente}:${n}`, titulo: ESTRELLAS[n] })),
  };
}

/** El incidente debe ser del reportante que escribe. */
async function incidenteDelReportante(s: Sesion, idIncidente: number) {
  return queryOne(
    `SELECT i.id_incidente, i.codigo, i.calificacion, e.codigo AS estado, e.nombre AS estado_nombre
       FROM incidente i JOIN estado_incidente e USING (id_estado) WHERE i.id_incidente = $1 AND i.id_reportante = $2`,
    [idIncidente, s.usuario.id_usuario],
  );
}

async function confirmarSolucion(s: Sesion, id: string) {
  const [, respuesta, idInc] = id.split(':');
  const inc = await incidenteDelReportante(s, Number(idInc));
  if (!inc) return s.decir('No encontré ese reporte.');
  if (inc.estado !== 'EN_VERIFICACION') return s.decir(`El reporte *${inc.codigo}* ya no está en verificación (estado actual: ${inc.estado_nombre}).`);
  if (respuesta === 'si') {
    await query(
      `UPDATE verificacion_cierre SET confirmacion_reportante = TRUE
        WHERE id_verificacion = (SELECT id_verificacion FROM verificacion_cierre WHERE id_incidente = $1 ORDER BY creado_en DESC LIMIT 1)`,
      [inc.id_incidente],
    );
    const cerrado = await cierreAutomatico(inc.id_incidente, false);
    await s.decir(cerrado ? `¡Gracias por confirmar! 🙌 El reporte *${inc.codigo}* quedó *resuelto* ✅` : '¡Gracias por confirmar! 🙌 Coordinación cerrará el reporte.');
    return s.enviar(listaCalificacion(inc.id_incidente, inc.codigo));
  }
  await s.guardar('CONSULTA', { paso: 'motivo_no', idIncidente: inc.id_incidente });
  return s.decir('Lamento que siga el problema 😕. Cuéntame brevemente qué sigue fallando y se lo aviso al técnico.');
}

async function noSolucionado(s: Sesion, motivo: string) {
  const inc = await incidenteDelReportante(s, s.ctx.idIncidente);
  await s.guardar('INICIO', {});
  if (!inc || inc.estado !== 'EN_VERIFICACION') return s.decir('Ese reporte ya cambió de estado; coordinación lo está revisando.');
  await transaccion({ ...ctxTransaccion(s), comentario: motivo.slice(0, 500) }, (c) => cambiarEstado(c, inc, 'EN_PROCESO', s.actor, motivo.slice(0, 500)));
  return s.decir(`Gracias. Avisé al técnico para que revise de nuevo *${inc.codigo}* 🔧`);
}

async function calificar(s: Sesion, id: string) {
  const [, idInc, nota] = id.split(':');
  const inc = await incidenteDelReportante(s, Number(idInc));
  if (!inc) return s.decir('No encontré ese reporte.');
  await query(`UPDATE incidente SET calificacion = $2 WHERE id_incidente = $1`, [inc.id_incidente, Number(nota)]);
  return s.decir(`¡Gracias por tu calificación (${ESTRELLAS[Number(nota)]})! Nos ayuda a mejorar el servicio 💙`);
}

// =============================================================== Técnico líder por WhatsApp
/** Incidente con su asignación actual y la carga del técnico asignado (lo que necesita ver el líder). */
async function incidenteParaLider(idIncidente: number) {
  return queryOne(
    `SELECT i.id_incidente, i.codigo, i.titulo, i.descripcion, i.id_categoria, i.id_ubicacion, i.id_tecnico, i.fecha_limite,
            e.codigo AS estado, e.nombre AS estado_nombre, e.es_final, p.nombre AS prioridad, c.nombre AS categoria,
            COALESCE(u.codigo || ' · ' || u.nombre, i.ubicacion_texto) AS lugar, r.nombres || ' ' || r.apellidos AS reportante,
            ct.tecnico, ct.activos, ct.max_activos
       FROM incidente i JOIN estado_incidente e USING (id_estado)
       LEFT JOIN prioridad p ON p.id_prioridad = i.id_prioridad
       LEFT JOIN categoria c ON c.id_categoria = i.id_categoria
       LEFT JOIN ubicacion u ON u.id_ubicacion = i.id_ubicacion
       JOIN usuario r ON r.id_usuario = i.id_reportante
       LEFT JOIN v_carga_tecnico ct ON ct.id_tecnico = i.id_tecnico
      WHERE i.id_incidente = $1`,
    [idIncidente],
  );
}

/** Aviso al líder: el reporte, a quién lo asignó el sistema y los botones para dejarlo así o cambiarlo. */
export async function mensajeLider(idIncidente: number): Promise<Salida> {
  const inc = await incidenteParaLider(idIncidente);
  if (!inc) return { tipo: 'texto', texto: 'No encontré ese incidente.' };
  const asignado = inc.tecnico
    ? `👷 Asignado por el sistema a: *${inc.tecnico}* (${inc.activos}/${inc.max_activos} activos)`
    : '⚠️ *Sin técnico asignado*: nadie disponible cumple la categoría y el bloque, o no se reconoció el lugar.';
  return {
    tipo: 'botones',
    texto:
      `🛠 *Nuevo reporte*\n\n*${inc.codigo}* · ${inc.titulo}\n🏷️ ${inc.categoria ?? '—'} · Prioridad ${inc.prioridad ?? '—'}\n📍 ${inc.lugar ?? '—'}\n\n` +
      `${asignado}\n\n${inc.tecnico ? '¿Lo dejas así o cambias el técnico?' : '¿A quién se lo asignas?'}`,
    botones: [
      ...(inc.tecnico ? [{ id: `lid:ok:${idIncidente}`, titulo: 'Dejar así' }] : []),
      { id: `lid:cambiar:${idIncidente}`, titulo: inc.tecnico ? 'Cambiar técnico' : 'Asignar técnico' },
      { id: `lid:detalle:${idIncidente}`, titulo: 'Ver detalle' },
    ],
  };
}

/** Técnicos para elegir: primero los que atienden la categoría, disponibles, con cupo y en su zona; el primero es el sugerido. */
async function candidatosLider(inc: any) {
  return query(
    `SELECT c.id_tecnico, c.tecnico, c.activos, c.max_activos, c.disponible, c.cupo_libre,
            COALESCE(tc.es_principal, FALSE) AS principal, tc.id_tecnico IS NOT NULL AS atiende,
            (NOT EXISTS (SELECT 1 FROM tecnico_bloque tb WHERE tb.id_tecnico = c.id_tecnico)
             OR EXISTS (SELECT 1 FROM tecnico_bloque tb JOIN ubicacion u ON u.id_bloque = tb.id_bloque
                         WHERE tb.id_tecnico = c.id_tecnico AND u.id_ubicacion = $2)) AS cubre
       FROM v_carga_tecnico c
       LEFT JOIN tecnico_categoria tc ON tc.id_tecnico = c.id_tecnico AND tc.id_categoria = $1
      WHERE c.id_tecnico IS DISTINCT FROM $3
      ORDER BY (tc.id_tecnico IS NOT NULL) DESC, c.disponible DESC, (c.cupo_libre > 0) DESC,
               COALESCE(tc.es_principal, FALSE) DESC, c.activos, c.tecnico
      LIMIT 10`,
    [inc.id_categoria, inc.id_ubicacion, inc.id_tecnico],
  );
}

async function lider(s: Sesion, accion: string, idInc: number, idTec?: number) {
  const inc = await incidenteParaLider(idInc);
  if (!inc) return s.decir('No encontré ese incidente.');
  if (accion === 'detalle') {
    const lim = inc.fecha_limite ? new Date(inc.fecha_limite).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    return s.decir(
      `🔎 *${inc.codigo}* · ${inc.titulo}\n\n📝 ${inc.descripcion}\n📍 ${inc.lugar ?? '—'}\n🏷️ ${inc.categoria ?? '—'} · Prioridad ${inc.prioridad ?? '—'}\n` +
        `👤 Reportó: ${inc.reportante}\n👷 Técnico: ${inc.tecnico ?? 'sin asignar'}\n⏰ Tiempo estimado: hasta ${lim}\nEstado: ${inc.estado_nombre}`,
    );
  }
  if (accion === 'ok') return s.decir(`👍 Listo, *${inc.tecnico ?? 'el técnico asignado'}* queda a cargo de *${inc.codigo}*.`);
  if (inc.es_final || !['PENDIENTE', 'ASIGNADO'].includes(inc.estado)) {
    return s.decir(`*${inc.codigo}* ya está ${inc.estado_nombre.toLowerCase()}. Para cambiar el técnico ahora, pídeselo al coordinador.`);
  }
  if (accion === 'cambiar') {
    const lista = await candidatosLider(inc);
    if (!lista.length) return s.decir('No hay otros técnicos activos para asignar.');
    const sugerido = lista.find((t) => t.atiende && t.disponible && t.cupo_libre > 0 && t.cubre);
    return s.enviar({
      tipo: 'lista',
      texto: `👷 ¿A quién asignas *${inc.codigo}*?${inc.tecnico ? `\nAhora lo tiene: ${inc.tecnico} (${inc.activos}/${inc.max_activos}).` : ''}`,
      boton: 'Elegir técnico',
      filas: lista.map((t) => ({
        id: `lid:asignar:${inc.id_incidente}:${t.id_tecnico}`,
        titulo: `${t === sugerido ? '⭐ ' : ''}${t.tecnico}`,
        descripcion: [
          `${t.activos}/${t.max_activos} activos`,
          t.principal ? 'su especialidad' : t.atiende ? 'atiende la categoría' : 'otra especialidad',
          !t.disponible && 'no disponible',
          !t.cubre && 'fuera de su zona',
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    });
  }
  if (accion === 'asignar' && idTec) {
    if (inc.id_tecnico === idTec) return s.decir('Ese técnico ya tiene asignado el incidente.');
    const tec = await queryOne(`SELECT tecnico FROM v_carga_tecnico WHERE id_tecnico = $1`, [idTec]);
    if (!tec) return s.decir('No encontré ese técnico.');
    await transaccion({ ...ctxTransaccion(s), comentario: 'Reasignado por el técnico líder' }, async (c) => {
      // Queda registrado con el usuario del líder; el cambio de estado (Pendiente → Asignado) no se valida contra el rol técnico
      await c.query(`SELECT set_config('sgim.id_rol', '', true)`);
      await asignar(c, inc, idTec, {
        automatica: false,
        motivo: `Asignado por el técnico líder (${s.usuario.nombres} ${s.usuario.apellidos})`,
        idAsignadoPor: s.usuario.id_usuario,
        avisarLider: false,
      });
    });
    return s.decir(`✅ *${inc.codigo}* quedó asignado a *${tec.tecnico}*. Ya le avisé.`);
  }
}

/** El incidente debe estar asignado al técnico que escribe. */
async function incidenteDelTecnico(s: Sesion, idIncidente: number) {
  return queryOne(
    `SELECT i.id_incidente, i.codigo, i.titulo, i.descripcion, i.fecha_limite, i.ubicacion_texto,
            e.codigo AS estado, e.nombre AS estado_nombre, p.nombre AS prioridad, c.nombre AS categoria,
            u.codigo AS ubicacion_codigo, u.nombre AS ubicacion, r.nombres || ' ' || r.apellidos AS reportante
       FROM incidente i JOIN estado_incidente e USING (id_estado)
       LEFT JOIN prioridad p ON p.id_prioridad = i.id_prioridad
       LEFT JOIN categoria c ON c.id_categoria = i.id_categoria
       LEFT JOIN ubicacion u ON u.id_ubicacion = i.id_ubicacion
       JOIN usuario r ON r.id_usuario = i.id_reportante
      WHERE i.id_incidente = $1 AND i.id_tecnico = $2`,
    [idIncidente, s.usuario.id_tecnico],
  );
}

async function tecnico(s: Sesion, m: Entrante, foto: Foto | null) {
  const id = m.idRespuesta ?? '';
  const [, accion, idTxt, idTec] = id.split(':');

  if (id.startsWith('lid:')) {
    if (!s.usuario.es_lider) return s.decir('Solo el técnico líder puede cambiar asignaciones.');
    return lider(s, accion, Number(idTxt), idTec ? Number(idTec) : undefined);
  }

  if (id.startsWith('tec:')) {
    if (accion === 'otra') return s.decir('Envíame la otra foto 📷');
    const inc = await incidenteDelTecnico(s, Number(idTxt));
    if (!inc) return s.decir('Ese incidente ya no está asignado a ti.');
    if (accion === 'detalle') {
      const lim = inc.fecha_limite ? new Date(inc.fecha_limite).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : '—';
      return s.decir(
        `🔎 *${inc.codigo}* · ${inc.titulo}\n\n📝 ${inc.descripcion}\n📍 ${inc.ubicacion_codigo ? `${inc.ubicacion_codigo} · ${inc.ubicacion}` : inc.ubicacion_texto}\n` +
          `🏷️ ${inc.categoria ?? '—'} · Prioridad ${inc.prioridad ?? '—'}\n👤 Reportó: ${inc.reportante}\n⏰ Tiempo estimado: hasta ${lim}\nEstado: ${inc.estado_nombre}`,
      );
    }
    if (accion === 'aceptar') {
      if (inc.estado !== 'ASIGNADO') return s.decir(`*${inc.codigo}* está ${inc.estado_nombre.toLowerCase()}; no hace falta aceptarlo.`);
      await transaccion({ ...ctxTransaccion(s), comentario: 'Aceptado por WhatsApp' }, (c) => cambiarEstado(c, inc, 'EN_PROCESO', s.actor, 'Aceptado por WhatsApp'));
      await s.guardar('INICIO', { idIncidente: inc.id_incidente });
      return s.decir(`👍 Iniciaste la atención de *${inc.codigo}*.\nCuando termines, envíame aquí la *foto del trabajo terminado*.`);
    }
    if (accion === 'rechazar') {
      // Avisos antiguos con el botón "Rechazar": el técnico ya no decide; lo resuelve el líder
      return s.decir(`Las asignaciones las decide el técnico líder. Si no puedes atender *${inc.codigo}*, coméntaselo a él.`);
    }
    if (accion === 'terminar') {
      if (inc.estado !== 'EN_PROCESO') return s.decir(`*${inc.codigo}* está ${inc.estado_nombre.toLowerCase()}.`);
      await transaccion({ ...ctxTransaccion(s), comentario: 'Trabajo terminado (WhatsApp)' }, async (c) => {
        await c.query(
          `INSERT INTO accion_mantenimiento (id_incidente, id_tecnico, tipo, descripcion, canal, inicio, fin)
           VALUES ($1, $2, 'CORRECTIVA', 'Trabajo terminado; foto de cierre enviada por WhatsApp', 'WHATSAPP', now(), now())`,
          [inc.id_incidente, s.usuario.id_tecnico],
        );
        await cambiarEstado(c, inc, 'EN_VERIFICACION', s.actor, 'Trabajo terminado (WhatsApp)');
      });
      await s.guardar('INICIO', {});
      return s.decir(`✅ *${inc.codigo}* pasó a verificación. Coordinación revisará la foto y el reportante confirmará la solución.`);
    }
  }

  if (m.tipo === 'imagen') {
    if (!foto) return s.decir('No pude recibir la foto 😕. Intenta enviarla de nuevo.');
    // A qué incidente corresponde: el último aceptado por chat o el único en proceso
    const enProceso = await query(
      `SELECT i.id_incidente, i.codigo FROM incidente i JOIN estado_incidente e USING (id_estado)
        WHERE i.id_tecnico = $1 AND e.codigo = 'EN_PROCESO' ORDER BY (i.id_incidente = $2) DESC, i.fecha_inicio_atencion DESC`,
      [s.usuario.id_tecnico, s.ctx.idIncidente ?? -1],
    );
    if (!enProceso.length) return s.decir('No tienes incidentes en proceso. Inicia la atención desde tu panel (*Mis incidentes*) para poder enviar la foto de cierre.');
    const inc = enProceso[0];
    const ev = await queryOne(
      `INSERT INTO evidencia (id_incidente, id_mensaje, id_subido_por, tipo, url_archivo, mime_type, tamano_bytes, hash_sha256, descripcion)
       VALUES ($1, $2, $3, 'CIERRE', $4, $5, $6, $7, $8) RETURNING id_evidencia`,
      [inc.id_incidente, foto.idMensaje, s.usuario.id_usuario, foto.url, foto.mime, foto.tamano, foto.hash, m.caption?.slice(0, 255) || 'Foto de cierre enviada por WhatsApp'],
    );
    const v = await queryOne(`INSERT INTO verificacion_cierre (id_incidente, id_evidencia) VALUES ($1, $2) RETURNING id_verificacion`, [
      inc.id_incidente,
      ev!.id_evidencia,
    ]);
    enSegundoPlano(verificarCierreConIa(v!.id_verificacion)); // el agente compara antes y después sin hacer esperar al técnico
    await s.guardar('INICIO', { idIncidente: inc.id_incidente });
    return s.enviar({
      tipo: 'botones',
      texto: `📷 Foto de cierre guardada en *${inc.codigo}*${enProceso.length > 1 ? ` (tienes ${enProceso.length} en proceso; la asigné al más reciente)` : ''}.\n¿Terminaste el trabajo?`,
      botones: [
        { id: `tec:terminar:${inc.id_incidente}`, titulo: 'Sí, terminé' },
        { id: 'tec:otra:0', titulo: 'Enviar otra foto' },
      ],
    });
  }

  // Cualquier otro mensaje: resumen de sus incidentes activos
  const activos = await query(
    `SELECT i.id_incidente, i.codigo, i.titulo, e.codigo AS estado, e.nombre AS estado_nombre
       FROM incidente i JOIN estado_incidente e USING (id_estado)
      WHERE i.id_tecnico = $1 AND e.codigo IN ('ASIGNADO', 'EN_PROCESO') ORDER BY e.orden, i.fecha_limite`,
    [s.usuario.id_tecnico],
  );
  const propios = activos.length
    ? `Tus incidentes activos:\n\n${activos.map((a) => `• *${a.codigo}* · ${a.titulo} (${a.estado_nombre})`).join('\n')}\n\n` +
      'Los atiendes desde tu panel del SGIM. Para cerrar uno en proceso, también puedes enviarme aquí la foto del trabajo terminado.'
    : 'No tienes incidentes activos. Te aviso por aquí cuando te asignen uno.';
  await s.decir(`Hola ${s.usuario.nombres} 👋 ${propios}`);
  if (!s.usuario.es_lider) return;
  // El líder ve además los reportes que aún no tienen técnico
  const sinTecnico = await query(
    `SELECT i.id_incidente, i.codigo, i.titulo FROM incidente i JOIN estado_incidente e USING (id_estado)
      WHERE e.codigo = 'PENDIENTE' ORDER BY i.fecha_reporte LIMIT 3`,
  );
  for (const p of sinTecnico) await s.enviar(await mensajeLider(p.id_incidente));
}
