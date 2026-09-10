# Puerto de Sevilla · Gestión de turnos de voluntarios

Conjunto de tres páginas HTML independientes (sin build ni dependencias que instalar)
para organizar los turnos de los voluntarios del Puerto de Sevilla. Cada archivo se
abre directamente en el navegador o se publica como página estática.

## Archivos

| Archivo | Uso | Público | Backend |
|---|---|---|---|
| [`disponibilidad.html`](disponibilidad.html) | Formulario para que cada voluntario registre su disponibilidad semanal (5 semanas × 7 días, hora de entrada/salida). | Voluntarios | Google Apps Script (`APP_URL`) que escribe en una hoja de cálculo. |
| [`planificador.html`](planificador.html) | Panel de administración: cuadrante mensual con motor de planificación automática, balance de carga, alertas de portador de llave, gestión de voluntarios, bajas y sustituciones, archivo de meses, reglas del motor y notificaciones (navegador + Telegram opcional). | Coordinación | Supabase REST (`SUPA_URL` / `SUPA_KEY`). |
| [`sustituciones.html`](sustituciones.html) | Portal para que un voluntario de baja libere sus turnos y otro se apunte a cubrirlos. | Voluntarios | Supabase REST (`SU` / `SK`). |

`planificador.html` y `sustituciones.html` comparten la misma base de datos Supabase.
La configuración del portal de sustituciones se sincroniza vía la tabla `config_portal`
y se cachea en `localStorage`.

## Motor de planificación (`planificador.html`)

Genera el cuadrante a partir de la disponibilidad, el historial de turnos y el
calendario de días activos. Los días ya confirmados no se recalculan nunca.

Hay dos motores, seleccionables con el toggle **Motor con visión global** de la
pestaña **Reglas del motor**:

- **Motor global** (por defecto). Planifica el mes entero de una pasada.
  - *Fase 1 — cobertura:* coloca 1 turno en cada día posible, procesando los días
    del más apretado al más holgado. Dentro de cada equipo elige a los voluntarios
    por **coste de oportunidad**: quien hace falta pronto en un día con poca gente
    donde también está disponible, se reserva para ese día.
  - *Fase 2 — ampliación:* añade 2º/3er turno solo donde sobra gente y sin dejar
    que ningún día futuro dentro de la ventana de descanso baje del mínimo.
  - *Descanso:* intenta `DESC_OK`; baja 1 a 1 hasta `DESC_FLOOR` solo si el día
    quedaría sin ningún turno. Nunca por debajo de `DESC_FLOOR`.
- **Motor por-día** (legacy). Resuelve cada día de forma aislada en orden
  cronológico. Se conserva como alternativa.

En ambos, tras formar los equipos se aplica la regla del portador de llave
(primer turno, último turno y turnos junto a un hueco horario necesitan un
portador presente).

Parámetros en **Reglas del motor** (se guardan en `localStorage` →
`reglas_cuadrante`):

| Regla | Def. | Descripción |
|---|---|---|
| `DESC_OK` | 5 | Días de descanso objetivo entre turnos |
| `DESC_FLOOR` | 3 | Suelo absoluto de descanso (motor global) |
| `DESC_MIN` | 2 | Descanso mínimo del motor por-día (legacy) |
| `IDEAL` | 4 | Voluntarios ideales por turno |
| `MIN_EQ` | 3 | Mínimo aceptable por turno |
| `DUR` | 2 | Duración del turno en horas |
| `VENTANA_CARGA` | 60 | Días para equilibrar la carga por voluntario |
| `MAX_TURNOS_DIA` | 3 | Tope de turnos por día |
| `motorGlobal` | true | Motor global (true) o por-día (false) |

Se pueden definir excepciones por día concreto (clave `excepcion_dia` en
`localStorage`): descanso, tamaño de equipo o "ignorar descanso".

### Exportar el cuadrante

- **Cuadrante → 📄 PDF** genera y descarga el PDF con **jsPDF** (se carga desde
  cdnjs la primera vez; sin conexión cae al diálogo de impresión del navegador).
  Bloque por día (barco, detalle horario, muelle) y por turno (hora, equipo con
  el portador de llave resaltado en ámbar, enlace "Añadir a Google Calendar" y al
  cuestionario). En los turnos sin cubrir enlaza al portal de sustituciones. Al
  pie, la nota de la llave y el contacto de bajas. Los enlaces son anotaciones
  reales del PDF: **funcionan en Firefox, Chrome y Adobe**.
- **Cuadrante → 📋 Sheet** copia el cuadrante como tabla (TSV) al portapapeles
  para pegar en Google Sheets.
- El enlace al cuestionario y el texto de contacto se editan en **Calendario →
  Ajustes del PDF** (`localStorage` → `pdf_cfg`). El detalle horario y el muelle
  de cada día se editan en la fila de ese día en **Calendario**.

## Configuración

Las credenciales van embebidas en cada HTML (constantes al inicio del `<script>`):

- **Supabase**: se usa la clave *publishable* (anónima). La seguridad depende de tener
  bien configuradas las políticas RLS en Supabase.
- **Google Apps Script**: `APP_URL` en `disponibilidad.html` (y la lógica de servidor
  vive en el propio proyecto de Apps Script, fuera de este repo).
- **Telegram** (opcional): el token del bot y el chat ID los introduce el usuario en
  el panel de notificaciones; se guardan solo en `localStorage`, no en el repo.

## Pruebas

El motor global tiene un banco de pruebas que carga el `<script>` de
`planificador.html` en un DOM simulado y lo ejercita con escenarios sintéticos
(reparto de cobertura, cascada de descanso, portador de llave, ventana de carga,
franjas habilitadas, mes completo):

```bash
node test/motor-global.test.js
```

## Despliegue

Son ficheros estáticos: sirve la carpeta con cualquier hosting estático
(GitHub Pages, Netlify, etc.) o abre los `.html` directamente. `planificador.html` y
`sustituciones.html` registran un service worker en línea para funcionar como PWA
instalable.
