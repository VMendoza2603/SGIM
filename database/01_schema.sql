-- =====================================================================
--  SISTEMA DE GESTIÓN DE INCIDENTES DE MANTENIMIENTO (SGIM)
--  Aplicativo web con agente inteligente integrado a WhatsApp
--  Motor: PostgreSQL 15+
--  Autores: Mendoza Mora Victor · Rodríguez Zambrano Carlos (UNEMI)
-- =====================================================================
--  Orden de ejecución: 01_schema.sql -> 02_seed.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS citext;     -- correos sin distinción de mayúsculas

CREATE SCHEMA IF NOT EXISTS sgim;
SET search_path TO sgim, public;

-- ---------------------------------------------------------------------
-- 1. TIPOS ENUMERADOS (valores fijos que no administra el usuario)
-- ---------------------------------------------------------------------
CREATE TYPE tipo_miembro       AS ENUM ('ESTUDIANTE', 'DOCENTE', 'ADMINISTRATIVO');
CREATE TYPE canal_tipo         AS ENUM ('WHATSAPP', 'WEB', 'SISTEMA');
CREATE TYPE direccion_mensaje  AS ENUM ('ENTRANTE', 'SALIENTE');
CREATE TYPE tipo_mensaje       AS ENUM ('TEXTO', 'IMAGEN', 'AUDIO', 'UBICACION', 'PLANTILLA', 'INTERACTIVO');
CREATE TYPE estado_entrega     AS ENUM ('RECIBIDO', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'FALLIDO');
CREATE TYPE tipo_evidencia     AS ENUM ('REPORTE', 'AVANCE', 'CIERRE');
CREATE TYPE tipo_analisis      AS ENUM ('TEXTO', 'IMAGEN', 'VERIFICACION_CIERRE');
CREATE TYPE tipo_accion        AS ENUM ('DIAGNOSTICO', 'CORRECTIVA', 'PREVENTIVA', 'OBSERVACION');
CREATE TYPE estado_operativo   AS ENUM ('OPERATIVO', 'CON_FALLA', 'FUERA_DE_SERVICIO', 'DADO_DE_BAJA');
CREATE TYPE resultado_verif    AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');
CREATE TYPE estado_notif       AS ENUM ('PENDIENTE', 'ENVIADA', 'ENTREGADA', 'LEIDA', 'FALLIDA');
CREATE TYPE estado_conversacion AS ENUM ('INICIO', 'ESPERANDO_DESCRIPCION', 'ESPERANDO_UBICACION',
                                         'ESPERANDO_FOTO', 'CONFIRMANDO', 'CONSULTA', 'FINALIZADA');

-- ---------------------------------------------------------------------
-- 2. SEGURIDAD: ROLES, PERMISOS Y USUARIOS
-- ---------------------------------------------------------------------
CREATE TABLE rol (
    id_rol          SMALLSERIAL PRIMARY KEY,
    codigo          VARCHAR(20)  NOT NULL UNIQUE,          -- ADMIN, TECNICO, COMUNIDAD
    nombre          VARCHAR(60)  NOT NULL,
    descripcion     VARCHAR(255),
    acceso_web      BOOLEAN      NOT NULL DEFAULT TRUE,     -- COMUNIDAD = FALSE (solo WhatsApp)
    activo          BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE permiso (
    id_permiso      SMALLSERIAL PRIMARY KEY,
    codigo          VARCHAR(60)  NOT NULL UNIQUE,          -- p.ej. incidente.asignar
    modulo          VARCHAR(40)  NOT NULL,
    descripcion     VARCHAR(255) NOT NULL
);

CREATE TABLE rol_permiso (
    id_rol          SMALLINT NOT NULL REFERENCES rol(id_rol) ON DELETE CASCADE,
    id_permiso      SMALLINT NOT NULL REFERENCES permiso(id_permiso) ON DELETE CASCADE,
    PRIMARY KEY (id_rol, id_permiso)
);

CREATE TABLE usuario (
    id_usuario      BIGSERIAL PRIMARY KEY,
    id_rol          SMALLINT     NOT NULL REFERENCES rol(id_rol),
    cedula          VARCHAR(13)  UNIQUE,
    nombres         VARCHAR(80)  NOT NULL,
    apellidos       VARCHAR(80)  NOT NULL,
    correo          CITEXT       UNIQUE,
    telefono_wa     VARCHAR(20)  UNIQUE,                    -- formato E.164 sin '+': 593979838115
    password_hash   VARCHAR(255),                           -- NULL para COMUNIDAD (no ingresa al panel)
    tipo_miembro    tipo_miembro,                           -- solo para COMUNIDAD
    foto_url        VARCHAR(500),
    debe_cambiar_pwd BOOLEAN     NOT NULL DEFAULT TRUE,
    intentos_fallidos SMALLINT   NOT NULL DEFAULT 0,
    bloqueado_hasta TIMESTAMPTZ,
    ultimo_acceso   TIMESTAMPTZ,
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_usuario_contacto CHECK (correo IS NOT NULL OR telefono_wa IS NOT NULL),
    CONSTRAINT ck_usuario_telefono CHECK (telefono_wa IS NULL OR telefono_wa ~ '^[0-9]{10,15}$')
);

CREATE TABLE token_recuperacion (
    id_token        BIGSERIAL PRIMARY KEY,
    id_usuario      BIGINT       NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL UNIQUE,
    expira_en       TIMESTAMPTZ  NOT NULL,
    usado_en        TIMESTAMPTZ,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE sesion (
    id_sesion       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    id_usuario      BIGINT       NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
    refresh_hash    VARCHAR(255) NOT NULL,
    ip              INET,
    user_agent      VARCHAR(300),
    expira_en       TIMESTAMPTZ  NOT NULL,
    revocada        BOOLEAN      NOT NULL DEFAULT FALSE,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. INFRAESTRUCTURA: SEDES, BLOQUES, UBICACIONES Y EQUIPOS
-- ---------------------------------------------------------------------
CREATE TABLE sede (
    id_sede         SERIAL PRIMARY KEY,
    nombre          VARCHAR(120) NOT NULL UNIQUE,           -- Unidad educativa / campus
    direccion       VARCHAR(255),
    activo          BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE bloque (
    id_bloque       SERIAL PRIMARY KEY,
    id_sede         INT          NOT NULL REFERENCES sede(id_sede),
    codigo          VARCHAR(20)  NOT NULL,                  -- p.ej. "B"
    nombre          VARCHAR(120) NOT NULL,                  -- p.ej. "Bloque B - Aulas"
    pisos           SMALLINT     NOT NULL DEFAULT 1 CHECK (pisos > 0),
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    UNIQUE (id_sede, codigo)
);

CREATE TABLE tipo_ubicacion (
    id_tipo_ubicacion SMALLSERIAL PRIMARY KEY,
    nombre          VARCHAR(60)  NOT NULL UNIQUE,           -- Aula, Laboratorio, Baño, Oficina...
    criticidad      SMALLINT     NOT NULL DEFAULT 1 CHECK (criticidad BETWEEN 1 AND 5)
);

CREATE TABLE ubicacion (
    id_ubicacion    SERIAL PRIMARY KEY,
    id_bloque       INT          NOT NULL REFERENCES bloque(id_bloque),
    id_tipo_ubicacion SMALLINT   NOT NULL REFERENCES tipo_ubicacion(id_tipo_ubicacion),
    codigo          VARCHAR(30)  NOT NULL,                  -- p.ej. "B-204"
    nombre          VARCHAR(120) NOT NULL,
    piso            SMALLINT     NOT NULL DEFAULT 1,
    capacidad       SMALLINT,
    codigo_qr       VARCHAR(60)  UNIQUE,                    -- opcional: QR pegado en el aula
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    UNIQUE (id_bloque, codigo)
);

CREATE TABLE categoria (
    id_categoria    SMALLSERIAL PRIMARY KEY,
    codigo          VARCHAR(20)  NOT NULL UNIQUE,           -- ILUM, CLIM, ELEC, AGUA, MOBI, SEGU
    nombre          VARCHAR(60)  NOT NULL UNIQUE,
    descripcion     VARCHAR(255),
    peso_riesgo     SMALLINT     NOT NULL DEFAULT 1 CHECK (peso_riesgo BETWEEN 1 AND 5),
    icono           VARCHAR(40),
    color_hex       CHAR(7),
    activo          BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE tipo_equipo (
    id_tipo_equipo  SMALLSERIAL PRIMARY KEY,
    id_categoria    SMALLINT     NOT NULL REFERENCES categoria(id_categoria),
    nombre          VARCHAR(80)  NOT NULL UNIQUE,           -- Aire acondicionado split, Luminaria LED...
    vida_util_meses SMALLINT,
    frecuencia_preventivo_dias SMALLINT                     -- para sugerir mantenimiento preventivo
);

CREATE TABLE equipo (
    id_equipo       SERIAL PRIMARY KEY,
    id_tipo_equipo  SMALLINT     NOT NULL REFERENCES tipo_equipo(id_tipo_equipo),
    id_ubicacion    INT          NOT NULL REFERENCES ubicacion(id_ubicacion),
    codigo_inventario VARCHAR(40) NOT NULL UNIQUE,
    marca           VARCHAR(60),
    modelo          VARCHAR(60),
    numero_serie    VARCHAR(80),
    fecha_instalacion DATE,
    ultimo_mantenimiento DATE,
    estado          estado_operativo NOT NULL DEFAULT 'OPERATIVO',
    observaciones   TEXT,
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 4. TÉCNICOS
-- ---------------------------------------------------------------------
CREATE TABLE tecnico (
    id_tecnico      SERIAL PRIMARY KEY,
    id_usuario      BIGINT       NOT NULL UNIQUE REFERENCES usuario(id_usuario),
    disponible      BOOLEAN      NOT NULL DEFAULT TRUE,
    max_activos     SMALLINT     NOT NULL DEFAULT 5 CHECK (max_activos > 0),
    turno           VARCHAR(20)  NOT NULL DEFAULT 'MATUTINO' CHECK (turno IN ('MATUTINO','VESPERTINO','NOCTURNO','COMPLETO')),
    observaciones   VARCHAR(255)
);

-- Especialidades: un técnico atiende una o varias categorías
CREATE TABLE tecnico_categoria (
    id_tecnico      INT      NOT NULL REFERENCES tecnico(id_tecnico) ON DELETE CASCADE,
    id_categoria    SMALLINT NOT NULL REFERENCES categoria(id_categoria),
    es_principal    BOOLEAN  NOT NULL DEFAULT FALSE,
    PRIMARY KEY (id_tecnico, id_categoria)
);

-- Zonas de cobertura (opcional): bloques que atiende el técnico
CREATE TABLE tecnico_bloque (
    id_tecnico      INT NOT NULL REFERENCES tecnico(id_tecnico) ON DELETE CASCADE,
    id_bloque       INT NOT NULL REFERENCES bloque(id_bloque),
    PRIMARY KEY (id_tecnico, id_bloque)
);

-- ---------------------------------------------------------------------
-- 5. CATÁLOGOS DEL FLUJO: PRIORIDAD, ESTADO Y TRANSICIONES
-- ---------------------------------------------------------------------
CREATE TABLE prioridad (
    id_prioridad    SMALLSERIAL PRIMARY KEY,
    codigo          VARCHAR(10)  NOT NULL UNIQUE,           -- BAJA, MEDIA, ALTA
    nombre          VARCHAR(30)  NOT NULL,
    nivel           SMALLINT     NOT NULL UNIQUE,           -- 1 = baja ... 3 = alta
    puntaje_min     SMALLINT     NOT NULL,                  -- rango del puntaje del motor de reglas
    puntaje_max     SMALLINT     NOT NULL,
    horas_respuesta SMALLINT     NOT NULL,                  -- SLA de primera atención
    horas_solucion  SMALLINT     NOT NULL,                  -- SLA de resolución
    color_hex       CHAR(7),
    CHECK (puntaje_min <= puntaje_max)
);

CREATE TABLE estado_incidente (
    id_estado       SMALLSERIAL PRIMARY KEY,
    codigo          VARCHAR(20)  NOT NULL UNIQUE,
    nombre          VARCHAR(40)  NOT NULL,
    orden           SMALLINT     NOT NULL,
    es_final        BOOLEAN      NOT NULL DEFAULT FALSE,
    visible_usuario VARCHAR(60)  NOT NULL                   -- texto que ve el reportante en WhatsApp
);

-- Máquina de estados: qué transiciones están permitidas y para qué rol
CREATE TABLE transicion_estado (
    id_estado_origen  SMALLINT NOT NULL REFERENCES estado_incidente(id_estado),
    id_estado_destino SMALLINT NOT NULL REFERENCES estado_incidente(id_estado),
    id_rol            SMALLINT NOT NULL REFERENCES rol(id_rol),
    requiere_evidencia BOOLEAN NOT NULL DEFAULT FALSE,
    requiere_comentario BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (id_estado_origen, id_estado_destino, id_rol),
    CHECK (id_estado_origen <> id_estado_destino)
);

-- ---------------------------------------------------------------------
-- 6. CANAL WHATSAPP: CONVERSACIONES Y MENSAJES
-- ---------------------------------------------------------------------
CREATE TABLE conversacion (
    id_conversacion BIGSERIAL PRIMARY KEY,
    id_usuario      BIGINT       REFERENCES usuario(id_usuario),   -- NULL si el número aún no está registrado
    telefono_wa     VARCHAR(20)  NOT NULL,
    estado          estado_conversacion NOT NULL DEFAULT 'INICIO',
    contexto        JSONB        NOT NULL DEFAULT '{}'::jsonb,       -- memoria de corto plazo del agente
    iniciada_en     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ultima_actividad TIMESTAMPTZ NOT NULL DEFAULT now(),
    cerrada_en      TIMESTAMPTZ
);

CREATE TABLE mensaje (
    id_mensaje      BIGSERIAL PRIMARY KEY,
    id_conversacion BIGINT       NOT NULL REFERENCES conversacion(id_conversacion) ON DELETE CASCADE,
    wa_message_id   VARCHAR(128) UNIQUE,                    -- id de Meta: evita procesar duplicados del webhook
    direccion       direccion_mensaje NOT NULL,
    tipo            tipo_mensaje NOT NULL,
    contenido       TEXT,
    media_id        VARCHAR(128),                           -- id del archivo en Meta
    media_url       VARCHAR(500),                           -- copia en almacenamiento propio
    payload         JSONB,                                  -- cuerpo crudo del webhook
    estado          estado_entrega NOT NULL DEFAULT 'RECIBIDO',
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 7. NÚCLEO: INCIDENTES
-- ---------------------------------------------------------------------
CREATE SEQUENCE seq_codigo_incidente START 1;

CREATE TABLE incidente (
    id_incidente    BIGSERIAL PRIMARY KEY,
    codigo          VARCHAR(20)  NOT NULL UNIQUE,           -- INC-2026-000123 (lo genera un trigger)
    id_reportante   BIGINT       NOT NULL REFERENCES usuario(id_usuario),
    id_conversacion BIGINT       REFERENCES conversacion(id_conversacion),
    canal           canal_tipo   NOT NULL DEFAULT 'WHATSAPP',
    titulo          VARCHAR(150) NOT NULL,                  -- resumen generado por el agente
    descripcion     TEXT         NOT NULL,                  -- texto original del usuario
    id_ubicacion    INT          REFERENCES ubicacion(id_ubicacion),
    ubicacion_texto VARCHAR(255),                           -- lo que escribió el usuario si no se pudo resolver
    id_equipo       INT          REFERENCES equipo(id_equipo),
    id_categoria    SMALLINT     REFERENCES categoria(id_categoria),
    id_prioridad    SMALLINT     REFERENCES prioridad(id_prioridad),
    id_estado       SMALLINT     NOT NULL REFERENCES estado_incidente(id_estado),
    id_tecnico      INT          REFERENCES tecnico(id_tecnico),  -- técnico asignado actualmente
    puntaje_prioridad SMALLINT,                             -- resultado del motor de reglas
    prioridad_manual BOOLEAN     NOT NULL DEFAULT FALSE,    -- TRUE si el coordinador la corrigió
    categoria_manual BOOLEAN     NOT NULL DEFAULT FALSE,
    diagnostico_preliminar TEXT,                            -- interpretación del agente IA
    afecta_clases   BOOLEAN,
    personas_afectadas SMALLINT,
    fecha_reporte   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    fecha_asignacion TIMESTAMPTZ,
    fecha_inicio_atencion TIMESTAMPTZ,
    fecha_resolucion TIMESTAMPTZ,
    fecha_cierre    TIMESTAMPTZ,
    fecha_limite    TIMESTAMPTZ,                            -- según SLA de la prioridad
    calificacion    SMALLINT CHECK (calificacion BETWEEN 1 AND 5),   -- valoración del reportante
    comentario_calificacion VARCHAR(500),
    actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_incidente_ubicacion CHECK (id_ubicacion IS NOT NULL OR ubicacion_texto IS NOT NULL),
    CONSTRAINT ck_incidente_fechas CHECK (
        (fecha_asignacion IS NULL OR fecha_asignacion >= fecha_reporte) AND
        (fecha_cierre     IS NULL OR fecha_cierre     >= fecha_reporte))
);

-- Historial de asignaciones (reasignaciones incluidas)
CREATE TABLE asignacion (
    id_asignacion   BIGSERIAL PRIMARY KEY,
    id_incidente    BIGINT       NOT NULL REFERENCES incidente(id_incidente) ON DELETE CASCADE,
    id_tecnico      INT          NOT NULL REFERENCES tecnico(id_tecnico),
    id_asignado_por BIGINT       REFERENCES usuario(id_usuario),   -- NULL = asignación automática
    automatica      BOOLEAN      NOT NULL DEFAULT TRUE,
    motivo          VARCHAR(255),
    activa          BOOLEAN      NOT NULL DEFAULT TRUE,
    aceptada_en     TIMESTAMPTZ,
    asignado_en     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finalizada_en   TIMESTAMPTZ
);
-- Solo una asignación activa por incidente
CREATE UNIQUE INDEX ux_asignacion_activa ON asignacion(id_incidente) WHERE activa;

-- Bitácora de cambios de estado (trazabilidad completa)
CREATE TABLE historial_estado (
    id_historial    BIGSERIAL PRIMARY KEY,
    id_incidente    BIGINT       NOT NULL REFERENCES incidente(id_incidente) ON DELETE CASCADE,
    id_estado_anterior SMALLINT  REFERENCES estado_incidente(id_estado),
    id_estado_nuevo SMALLINT     NOT NULL REFERENCES estado_incidente(id_estado),
    id_usuario      BIGINT       REFERENCES usuario(id_usuario),   -- NULL = cambio del sistema/agente
    canal           canal_tipo   NOT NULL DEFAULT 'SISTEMA',
    comentario      VARCHAR(500),
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Trabajos realizados por el técnico
CREATE TABLE accion_mantenimiento (
    id_accion       BIGSERIAL PRIMARY KEY,
    id_incidente    BIGINT       NOT NULL REFERENCES incidente(id_incidente) ON DELETE CASCADE,
    id_tecnico      INT          NOT NULL REFERENCES tecnico(id_tecnico),
    tipo            tipo_accion  NOT NULL,
    descripcion     TEXT         NOT NULL,
    materiales      TEXT,                                   -- solo descriptivo (costos fuera de alcance)
    canal           canal_tipo   NOT NULL DEFAULT 'WEB',
    inicio          TIMESTAMPTZ,
    fin             TIMESTAMPTZ,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (fin IS NULL OR inicio IS NULL OR fin >= inicio)
);

-- Fotografías: del reporte, del avance y del cierre
CREATE TABLE evidencia (
    id_evidencia    BIGSERIAL PRIMARY KEY,
    id_incidente    BIGINT       NOT NULL REFERENCES incidente(id_incidente) ON DELETE CASCADE,
    id_mensaje      BIGINT       REFERENCES mensaje(id_mensaje),
    id_accion       BIGINT       REFERENCES accion_mantenimiento(id_accion),
    id_subido_por   BIGINT       NOT NULL REFERENCES usuario(id_usuario),
    tipo            tipo_evidencia NOT NULL,
    url_archivo     VARCHAR(500) NOT NULL,
    mime_type       VARCHAR(50)  NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
    tamano_bytes    INT          CHECK (tamano_bytes > 0),
    hash_sha256     CHAR(64),                               -- detectar fotos repetidas
    descripcion     VARCHAR(255),
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 8. AGENTE DE IA: ANÁLISIS, REGLAS DE PRIORIDAD Y VERIFICACIÓN
-- ---------------------------------------------------------------------
CREATE TABLE analisis_ia (
    id_analisis     BIGSERIAL PRIMARY KEY,
    id_incidente    BIGINT       NOT NULL REFERENCES incidente(id_incidente) ON DELETE CASCADE,
    id_evidencia    BIGINT       REFERENCES evidencia(id_evidencia),   -- si el análisis fue de una imagen
    tipo            tipo_analisis NOT NULL,
    modelo          VARCHAR(80)  NOT NULL,                  -- nombre/versión del LLM o modelo de visión
    version_prompt  VARCHAR(20),
    id_categoria_sugerida SMALLINT REFERENCES categoria(id_categoria),
    id_equipo_detectado   INT      REFERENCES equipo(id_equipo),
    tipo_equipo_detectado VARCHAR(80),
    confianza       NUMERIC(4,3) CHECK (confianza BETWEEN 0 AND 1),
    anomalias       JSONB,                                  -- ["cable expuesto", "mancha de humedad"]
    variables_riesgo JSONB,                                 -- {"riesgo_electrico":true,"afecta_clases":true}
    interpretacion  TEXT,                                   -- texto legible para el técnico
    respuesta_cruda JSONB,
    tokens_entrada  INT,
    tokens_salida   INT,
    latencia_ms     INT,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Motor de reglas configurable para calcular el puntaje de prioridad
CREATE TABLE regla_prioridad (
    id_regla        SERIAL PRIMARY KEY,
    nombre          VARCHAR(120) NOT NULL,
    descripcion     VARCHAR(255),
    variable        VARCHAR(60)  NOT NULL,                  -- p.ej. categoria, riesgo_electrico, tipo_ubicacion
    operador        VARCHAR(10)  NOT NULL CHECK (operador IN ('=','!=','>','>=','<','<=','IN','CONTAINS')),
    valor           VARCHAR(255) NOT NULL,
    puntos          SMALLINT     NOT NULL,                  -- puede ser negativo
    forzar_prioridad SMALLINT    REFERENCES prioridad(id_prioridad),  -- regla de escalamiento directo
    orden           SMALLINT     NOT NULL DEFAULT 100,
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    actualizado_por BIGINT       REFERENCES usuario(id_usuario),
    actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Qué reglas se dispararon en cada incidente (explicabilidad del puntaje)
CREATE TABLE incidente_regla (
    id_incidente    BIGINT  NOT NULL REFERENCES incidente(id_incidente) ON DELETE CASCADE,
    id_regla        INT     NOT NULL REFERENCES regla_prioridad(id_regla),
    puntos_aplicados SMALLINT NOT NULL,
    PRIMARY KEY (id_incidente, id_regla)
);

-- Verificación del cierre con evidencia fotográfica posterior a la reparación
CREATE TABLE verificacion_cierre (
    id_verificacion BIGSERIAL PRIMARY KEY,
    id_incidente    BIGINT       NOT NULL REFERENCES incidente(id_incidente) ON DELETE CASCADE,
    id_evidencia    BIGINT       NOT NULL REFERENCES evidencia(id_evidencia),
    id_analisis     BIGINT       REFERENCES analisis_ia(id_analisis),
    resultado_ia    resultado_verif NOT NULL DEFAULT 'PENDIENTE',
    confianza_ia    NUMERIC(4,3) CHECK (confianza_ia BETWEEN 0 AND 1),
    confirmacion_reportante BOOLEAN,                        -- respuesta "Sí, quedó solucionado" en WhatsApp
    resultado_final resultado_verif NOT NULL DEFAULT 'PENDIENTE',
    id_verificado_por BIGINT     REFERENCES usuario(id_usuario),     -- coordinador que valida
    observacion     VARCHAR(500),
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    verificado_en   TIMESTAMPTZ
);

-- ---------------------------------------------------------------------
-- 9. NOTIFICACIONES, CONFIGURACIÓN Y AUDITORÍA
-- ---------------------------------------------------------------------
CREATE TABLE notificacion (
    id_notificacion BIGSERIAL PRIMARY KEY,
    id_incidente    BIGINT       REFERENCES incidente(id_incidente) ON DELETE CASCADE,
    id_destinatario BIGINT       NOT NULL REFERENCES usuario(id_usuario),
    canal           canal_tipo   NOT NULL,
    evento          VARCHAR(40)  NOT NULL,                  -- ASIGNACION, CAMBIO_ESTADO, SLA_VENCIDO...
    titulo          VARCHAR(150) NOT NULL,
    cuerpo          TEXT         NOT NULL,
    plantilla_wa    VARCHAR(80),                            -- nombre de plantilla aprobada por Meta
    id_mensaje      BIGINT       REFERENCES mensaje(id_mensaje),
    estado          estado_notif NOT NULL DEFAULT 'PENDIENTE',
    intentos        SMALLINT     NOT NULL DEFAULT 0,
    error           VARCHAR(500),
    leida_en        TIMESTAMPTZ,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE parametro_sistema (
    clave           VARCHAR(60)  PRIMARY KEY,
    valor           TEXT         NOT NULL,
    tipo_dato       VARCHAR(10)  NOT NULL DEFAULT 'TEXT' CHECK (tipo_dato IN ('TEXT','INT','BOOL','JSON','DECIMAL')),
    descripcion     VARCHAR(255),
    editable        BOOLEAN      NOT NULL DEFAULT TRUE,
    actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE auditoria (
    id_auditoria    BIGSERIAL PRIMARY KEY,
    id_usuario      BIGINT       REFERENCES usuario(id_usuario),
    accion          VARCHAR(40)  NOT NULL,                  -- LOGIN, LOGIN_FALLIDO, CREAR, EDITAR, ELIMINAR...
    entidad         VARCHAR(60),
    id_entidad      VARCHAR(40),
    datos_anteriores JSONB,
    datos_nuevos    JSONB,
    ip              INET,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 10. ÍNDICES
-- ---------------------------------------------------------------------
CREATE INDEX ix_usuario_rol            ON usuario(id_rol);
CREATE INDEX ix_ubicacion_bloque       ON ubicacion(id_bloque);
CREATE INDEX ix_equipo_ubicacion       ON equipo(id_ubicacion);
CREATE INDEX ix_equipo_tipo            ON equipo(id_tipo_equipo);
CREATE INDEX ix_conversacion_tel       ON conversacion(telefono_wa, ultima_actividad DESC);
CREATE INDEX ix_mensaje_conv           ON mensaje(id_conversacion, creado_en);
CREATE INDEX ix_incidente_estado       ON incidente(id_estado);
CREATE INDEX ix_incidente_tecnico      ON incidente(id_tecnico, id_estado);
CREATE INDEX ix_incidente_reportante   ON incidente(id_reportante, fecha_reporte DESC);
CREATE INDEX ix_incidente_ubicacion    ON incidente(id_ubicacion, fecha_reporte DESC);   -- historial por ubicación
CREATE INDEX ix_incidente_equipo       ON incidente(id_equipo, fecha_reporte DESC);      -- historial por equipo
CREATE INDEX ix_incidente_categoria    ON incidente(id_categoria);
CREATE INDEX ix_incidente_fecha        ON incidente(fecha_reporte DESC);
CREATE INDEX ix_historial_incidente    ON historial_estado(id_incidente, creado_en);
CREATE INDEX ix_accion_incidente       ON accion_mantenimiento(id_incidente);
CREATE INDEX ix_evidencia_incidente    ON evidencia(id_incidente, tipo);
CREATE INDEX ix_analisis_incidente     ON analisis_ia(id_incidente);
CREATE INDEX ix_notif_destinatario     ON notificacion(id_destinatario, estado);
CREATE INDEX ix_auditoria_usuario      ON auditoria(id_usuario, creado_en DESC);
CREATE INDEX ix_auditoria_entidad      ON auditoria(entidad, id_entidad);

-- ---------------------------------------------------------------------
-- 11. FUNCIONES Y TRIGGERS
-- ---------------------------------------------------------------------

-- 11.1 Mantener actualizado_en
CREATE OR REPLACE FUNCTION fn_set_actualizado_en() RETURNS trigger AS $$
BEGIN
    NEW.actualizado_en := now();
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tg_usuario_upd   BEFORE UPDATE ON usuario   FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();
CREATE TRIGGER tg_equipo_upd    BEFORE UPDATE ON equipo    FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();
CREATE TRIGGER tg_incidente_upd BEFORE UPDATE ON incidente FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();

-- 11.2 Código legible del incidente: INC-AAAA-NNNNNN
CREATE OR REPLACE FUNCTION fn_codigo_incidente() RETURNS trigger AS $$
BEGIN
    IF NEW.codigo IS NULL THEN
        NEW.codigo := 'INC-' || to_char(now(), 'YYYY') || '-' ||
                      lpad(nextval('seq_codigo_incidente')::text, 6, '0');
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tg_incidente_codigo BEFORE INSERT ON incidente
    FOR EACH ROW EXECUTE FUNCTION fn_codigo_incidente();

-- 11.3 Fecha límite según SLA cuando se define o cambia la prioridad
CREATE OR REPLACE FUNCTION fn_fecha_limite() RETURNS trigger AS $$
DECLARE v_horas SMALLINT;
BEGIN
    IF NEW.id_prioridad IS NOT NULL AND
       (TG_OP = 'INSERT' OR NEW.id_prioridad IS DISTINCT FROM OLD.id_prioridad) THEN
        SELECT horas_solucion INTO v_horas FROM prioridad WHERE id_prioridad = NEW.id_prioridad;
        NEW.fecha_limite := NEW.fecha_reporte + make_interval(hours => v_horas);
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tg_incidente_sla BEFORE INSERT OR UPDATE OF id_prioridad ON incidente
    FOR EACH ROW EXECUTE FUNCTION fn_fecha_limite();

-- 11.4 Registrar automáticamente cada cambio de estado en historial_estado.
--      El backend puede indicar usuario/canal/comentario con:
--      SET LOCAL sgim.id_usuario = '12'; SET LOCAL sgim.canal = 'WEB'; SET LOCAL sgim.comentario = '...';
CREATE OR REPLACE FUNCTION fn_historial_estado() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.id_estado IS DISTINCT FROM OLD.id_estado THEN
        INSERT INTO historial_estado (id_incidente, id_estado_anterior, id_estado_nuevo,
                                      id_usuario, canal, comentario)
        VALUES (NEW.id_incidente,
                CASE WHEN TG_OP = 'UPDATE' THEN OLD.id_estado END,
                NEW.id_estado,
                NULLIF(current_setting('sgim.id_usuario', true), '')::bigint,
                COALESCE(NULLIF(current_setting('sgim.canal', true), ''), 'SISTEMA')::canal_tipo,
                NULLIF(current_setting('sgim.comentario', true), ''));
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tg_incidente_historial AFTER INSERT OR UPDATE OF id_estado ON incidente
    FOR EACH ROW EXECUTE FUNCTION fn_historial_estado();

-- 11.5 Validar que la transición de estado esté permitida (si el backend informa el rol)
CREATE OR REPLACE FUNCTION fn_validar_transicion() RETURNS trigger AS $$
DECLARE v_rol SMALLINT := NULLIF(current_setting('sgim.id_rol', true), '')::smallint;
BEGIN
    IF v_rol IS NOT NULL AND NEW.id_estado IS DISTINCT FROM OLD.id_estado THEN
        IF NOT EXISTS (SELECT 1 FROM transicion_estado
                        WHERE id_estado_origen = OLD.id_estado
                          AND id_estado_destino = NEW.id_estado
                          AND id_rol = v_rol) THEN
            RAISE EXCEPTION 'Transición de estado no permitida para este rol (% -> %)',
                OLD.id_estado, NEW.id_estado USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tg_incidente_transicion BEFORE UPDATE OF id_estado ON incidente
    FOR EACH ROW EXECUTE FUNCTION fn_validar_transicion();

-- 11.6 El técnico solo puede tener asignada una categoría que atiende (advertencia, no bloqueo)
--      Se resuelve en la capa de negocio; aquí solo se valida que el técnico esté activo.
CREATE OR REPLACE FUNCTION fn_validar_tecnico_activo() RETURNS trigger AS $$
BEGIN
    IF NEW.id_tecnico IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM tecnico t JOIN usuario u ON u.id_usuario = t.id_usuario
         WHERE t.id_tecnico = NEW.id_tecnico AND u.activo) THEN
        RAISE EXCEPTION 'El técnico % no está activo', NEW.id_tecnico;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tg_incidente_tecnico BEFORE INSERT OR UPDATE OF id_tecnico ON incidente
    FOR EACH ROW EXECUTE FUNCTION fn_validar_tecnico_activo();

-- ---------------------------------------------------------------------
-- 12. VISTAS PARA EL PANEL WEB
-- ---------------------------------------------------------------------

-- Bandeja de incidentes con todos los datos legibles
CREATE OR REPLACE VIEW v_incidente_detalle AS
SELECT i.id_incidente, i.codigo, i.titulo, i.descripcion, i.canal,
       i.fecha_reporte, i.fecha_limite, i.fecha_cierre,
       e.codigo  AS estado,     e.nombre AS estado_nombre,
       p.codigo  AS prioridad,  p.nivel  AS prioridad_nivel, i.puntaje_prioridad,
       c.codigo  AS categoria,  c.nombre AS categoria_nombre,
       s.nombre  AS sede, b.nombre AS bloque, u.codigo AS ubicacion_codigo, u.nombre AS ubicacion,
       eq.codigo_inventario AS equipo_codigo, te.nombre AS equipo_tipo,
       r.nombres || ' ' || r.apellidos AS reportante, r.tipo_miembro, r.telefono_wa,
       t.id_tecnico, ut.nombres || ' ' || ut.apellidos AS tecnico,
       (i.fecha_limite < now() AND NOT e.es_final) AS sla_vencido
FROM incidente i
JOIN estado_incidente e   ON e.id_estado = i.id_estado
JOIN usuario r            ON r.id_usuario = i.id_reportante
LEFT JOIN prioridad p     ON p.id_prioridad = i.id_prioridad
LEFT JOIN categoria c     ON c.id_categoria = i.id_categoria
LEFT JOIN ubicacion u     ON u.id_ubicacion = i.id_ubicacion
LEFT JOIN bloque b        ON b.id_bloque = u.id_bloque
LEFT JOIN sede s          ON s.id_sede = b.id_sede
LEFT JOIN equipo eq       ON eq.id_equipo = i.id_equipo
LEFT JOIN tipo_equipo te  ON te.id_tipo_equipo = eq.id_tipo_equipo
LEFT JOIN tecnico t       ON t.id_tecnico = i.id_tecnico
LEFT JOIN usuario ut      ON ut.id_usuario = t.id_usuario;

-- Carga de trabajo de cada técnico (usada por la asignación automática)
CREATE OR REPLACE VIEW v_carga_tecnico AS
SELECT t.id_tecnico, u.nombres || ' ' || u.apellidos AS tecnico, t.disponible, t.max_activos,
       COUNT(i.id_incidente) FILTER (WHERE NOT e.es_final) AS activos,
       t.max_activos - COUNT(i.id_incidente) FILTER (WHERE NOT e.es_final) AS cupo_libre
FROM tecnico t
JOIN usuario u ON u.id_usuario = t.id_usuario AND u.activo
LEFT JOIN incidente i        ON i.id_tecnico = t.id_tecnico
LEFT JOIN estado_incidente e ON e.id_estado = i.id_estado
GROUP BY t.id_tecnico, u.nombres, u.apellidos, t.disponible, t.max_activos;

-- Historial por ubicación y equipo (apoyo al mantenimiento preventivo)
CREATE OR REPLACE VIEW v_historial_ubicacion_equipo AS
SELECT u.id_ubicacion, u.codigo AS ubicacion, eq.id_equipo, eq.codigo_inventario,
       c.nombre AS categoria,
       COUNT(*)                                        AS total_incidentes,
       COUNT(*) FILTER (WHERE i.fecha_reporte > now() - interval '90 days') AS ultimos_90_dias,
       MAX(i.fecha_reporte)                            AS ultimo_incidente,
       AVG(EXTRACT(EPOCH FROM (i.fecha_resolucion - i.fecha_reporte))/3600)::numeric(8,1) AS horas_promedio_resolucion
FROM incidente i
JOIN ubicacion u       ON u.id_ubicacion = i.id_ubicacion
LEFT JOIN equipo eq    ON eq.id_equipo = i.id_equipo
LEFT JOIN categoria c  ON c.id_categoria = i.id_categoria
GROUP BY u.id_ubicacion, u.codigo, eq.id_equipo, eq.codigo_inventario, c.nombre;

-- Indicadores del dashboard
CREATE OR REPLACE VIEW v_kpi_dashboard AS
SELECT
    COUNT(*) FILTER (WHERE e.codigo = 'PENDIENTE')                  AS pendientes,
    COUNT(*) FILTER (WHERE e.codigo IN ('ASIGNADO','EN_PROCESO'))   AS en_atencion,
    COUNT(*) FILTER (WHERE e.codigo = 'EN_VERIFICACION')            AS por_verificar,
    COUNT(*) FILTER (WHERE e.codigo = 'RESUELTO'
                       AND i.fecha_cierre >= date_trunc('month', now())) AS resueltos_mes,
    COUNT(*) FILTER (WHERE i.fecha_limite < now() AND NOT e.es_final) AS sla_vencidos,
    AVG(EXTRACT(EPOCH FROM (i.fecha_resolucion - i.fecha_reporte))/3600)
        FILTER (WHERE i.fecha_resolucion IS NOT NULL)::numeric(8,1)   AS horas_promedio_resolucion
FROM incidente i
JOIN estado_incidente e ON e.id_estado = i.id_estado;
