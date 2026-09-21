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
  - *Huecos:* toda franja horaria habilitada en el calendario que quede sin
    cubrir aparece igualmente como turno vacío ("Sin cubrir"), tanto en el
    cuadrante (editable con el selector de voluntarios) como en el PDF (con
    enlace a Sustituciones) — nunca desaparece por no tener equipo.
- **Motor por-día** (legacy). Resuelve cada día de forma aislada en orden
  cronológico. Se conserva como alternativa.

En ambos, tras formar los equipos se aplica la regla del portador de llave
(primer turno, último turno y turnos junto a un hueco horario necesitan un
portador presente).

### Editar equipos a mano (excepción a la regla)

Cada turno del cuadrante muestra **4 plazas**. En las vacías, **＋ Añadir
voluntario** abre un selector con los disponibles de ese día y, aparte, toda la
lista de voluntarios (estos últimos se añaden como excepción, ignorando la
regla de descanso). Cada plaza ocupada tiene **⇄** (cambiar) y **✕** (quitar).
Un turno tocado a mano se marca **✏️ Editado** y **↩︎ Revertir** lo devuelve al
cálculo automático. **➕ Añadir turno manual / otro turno** crea un turno vacío
en una franja libre. Los cambios viven en memoria hasta que pulsas **✓
Confirmar** — y solo bloquea el turno que confirmas: un día con algún turno ya
confirmado sigue mostrando el resto de franjas habilitadas como huecos
editables (nunca desaparecen).

El descanso/disponibilidad que ves en el selector y en "Disponibles
adicionales" se recalcula **en vivo** cada vez que añades, cambias o quitas a
alguien — quitar a un voluntario de un turno lo libera al instante en el resto
del cuadrante (no hace falta un ↻ Recalc.). La sección "Todos los
voluntarios" avisa si esa persona ya está asignada cerca de esa fecha antes de
añadirla como excepción.

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

- **Cuadrante → 📄 PDF** genera y descarga el PDF a partir del **mismo HTML/CSS
  que usa la app** (`_buildPrintHTML`, con sus emoji e iconos habituales): se
  renderiza fuera de pantalla, se captura con **html2canvas** y se monta como
  imagen en el PDF con **jsPDF** (ambas se cargan desde cdnjs/jsdelivr la
  primera vez; sin conexión cae al diálogo de impresión del navegador). Encima
  de la imagen se superponen **anotaciones `/Link` reales**, calculadas a partir
  de la posición de cada enlace en el HTML — funcionan en Firefox, Chrome y
  Adobe igual, porque no dependen del motor de impresión del navegador.
  Bloque por día (barco, detalle horario, muelle) y por turno (hora, equipo con
  el portador de llave resaltado, enlace "Añadir a Google Calendar" y al
  cuestionario). En los turnos sin cubrir enlaza al portal de sustituciones. Al
  pie, la nota de la llave y el contacto de bajas. La paginación evita partir
  un bloque de día entre dos páginas.
- **Cuadrante → 📋 Sheet** copia el cuadrante como tabla (TSV) al portapapeles
  para pegar en Google Sheets.
- El enlace al cuestionario y el texto de contacto se editan en **Calendario →
  Ajustes del PDF** (`localStorage` → `pdf_cfg`). El detalle horario y el muelle
  de cada día se editan en la fila de ese día en **Calendario**.

## Vista "🛰️ En vivo" (`planificador.html`)

Un único tablero con **todo lo que pasa en los turnos**, para no tener que
saltar entre Bajas, Apuntes y Turnos confirmados. Cruza `historial` (equipo
confirmado) + `bajas` + `refuerzos` (apuntes de Sustituciones) + `calendario`
(franjas habilitadas) y se refresca sola cada 30 s mientras la pestaña está a la
vista.

- **Tarjeta por turno**, agrupada por día (con naviera y quién se ofrece "todo el
  día"): confirmados ✓, apuntados ✋, bajas 🏥 tachadas, quien había dado baja y
  se ha vuelto a apuntar ↩️, y el portador de llave 🔑. Semáforo: 🚨 sin cubrir ·
  ⚠️ faltan N (según `MIN_EQ`) · ✓ completo (según `IDEAL`). También avisa si el
  turno se quedó **sin portador de llave** tras una baja o si una franja
  habilitada vacía **se solapa** con un turno ya formado.
- **Filtros**: periodo, búsqueda por voluntario y estado (atención / con bajas /
  con apuntes / completos). El icono de la barra lateral muestra cuántos turnos
  de los próximos 14 días necesitan atención.
- **📋 Copiar aviso**: deja en el portapapeles un texto listo para el grupo con
  el hueco y el enlace a Sustituciones.
- **👥 Sugerir sustitutos** (en los turnos que necesitan atención): lista de
  quién puede cubrir, con el mismo cálculo de disponibilidad y descanso que la
  pestaña Bajas, más una comprobación propia de que su **horario cubra las horas
  del turno** (separa "cubren todo el turno", "solo parte" y "no disponibles").
  Quien se ofreció ese día sube arriba. Por candidato: 📋 copiar mensaje,
  💬 abrir WhatsApp con el texto ya escrito y ✓ Asignar (lo apunta al turno).
- **📊 Ficha de voluntario** (pulsa un nombre en En vivo, o *Voluntarios → 📊
  Ficha*): turnos hechos y próximos, bajas y tasa de baja, apuntes (y cancelados),
  último turno, carga de los últimos 60 días frente a la media del grupo, turnos
  por mes y avisos automáticos (🔥 carga alta, 💤 inactivo, ⚠️ bajas frecuentes).
- **⚡ Últimas novedades**: bajas, apuntes (y si cubren una baja), confirmaciones
  de equipo. Pulsar una novedad salta a su turno. Lo que no deja marca de tiempo
  en las tablas (apunte cancelado, baja anulada, persona quitada de un turno) sale
  de la tabla **`actividad`**, que rellenan unos disparadores de la base de datos
  ([`supabase/01_actividad.sql`](supabase/01_actividad.sql)) — queda registrado
  siempre. Si aún no la has creado, la vista lo detecta comparando con la última
  visita y lo guarda en el navegador (`envivo_snap` / `envivo_log`): solo se ve si
  esa app estaba abierta, pero nunca lo inventa.
- **Turnos confirmados** ahora marca con 🏥 y tachado a quien tiene una baja
  activa en ese turno.

## Estadísticas (`planificador.html` → 📈 Estadísticas)

Panel de actividad de todo el histórico (historial activo + archivado, bajas,
apuntes y voluntarios), por **periodo**: este mes, mes anterior, 3 o 6 meses,
este año, año anterior, todo el histórico o un rango de meses a medida. Cada
cifra se compara con el **periodo anterior** de la misma duración (▲▼).

- **Cifras clave:** turnos confirmados, plazas asignadas, bajas y tasa de baja,
  apuntes, turnos que **salen adelante por apuntes** (los salvados tras una baja
  y los que nadie planificó), turnos **caídos por bajas** (con equipo y a cero),
  personas por turno y participación.
- **Cómo acaban los turnos** (completos, justos, por debajo del mínimo, sin
  nadie), **antelación de las bajas** (cuántas llegan el mismo día o el anterior),
  **tendencia mensual**, **por día de la semana** y **mapa día × franja**.
- **💡 Qué podemos mejorar:** observaciones automáticas con su acción concreta
  (tasa de baja alta, bajas de última hora, un día que concentra bajas, turnos
  sin nadie o sin portador de llave, participación baja, dependencia de pocos
  voluntarios…). También señala lo que va bien.
- **Voluntarios:** tabla ordenable y filtrable (turnos, próximos, bajas, % de
  baja, apuntes, último turno; pulsar un nombre abre su ficha). Distingue quienes
  **dejaron de participar** (último turno hace más de 90 días) de los **sin
  estrenar** (nunca han tenido turno). Exporta a **CSV** y copia un **resumen**
  listo para pegar.
- Las cancelaciones de apuntes solo cuentan desde que se ejecutó
  `supabase/01_actividad.sql` (la vista lo indica).

### Meses gestionados fuera de la app

Las estadísticas solo conocen lo que se registró en la app. Para no dar
conclusiones falsas, cada mes se clasifica solo:

- **Con registro**: tiene turnos y algún rastro de bajas o apuntes.
- **Sin bajas ni apuntes** (¿gestión manual?): cuenta para turnos y participación,
  pero **no para las tasas de baja** (no diluyen el porcentaje). Si de verdad fue un
  mes tranquilo registrado en la app, se marca en *🩺 Calidad de los datos*.
- **Sin datos**: ningún turno; se muestra como hueco en el gráfico y se avisa.

Además, **nadie se da por "dejó de participar"** salvo que haya al menos 2 meses
con datos posteriores a su último turno (si hay un hueco de meses sin registrar de
por medio, se muestra aparte como "sin datos suficientes"). Y las tasas solo se
comentan a partir de 15 plazas con registro.

**📥 Importar turnos anteriores** recupera esos meses. Dos formas:

- **PDF del "Programa de Predicación"** (uno o varios a la vez). Se leen en el
  navegador con pdf.js (no se suben a ningún sitio): fecha, franja y equipo de cada
  turno. Los nombres vienen pegados en el PDF, así que se separan usando tu lista de
  voluntarios como diccionario (respeta nombres de 3 palabras y distingue nombres
  que comparten apellido). El año se toma del nombre del archivo (`…Mayo26.pdf`) y se
  comprueba que los días de la semana cuadren. Solo sirve para PDF con texto: el que
  genera esta app es una imagen, pero esos meses ya están en la app.
- **Texto pegado**, una línea por turno (`12/06/2026  10:00 a 12:00  ANA GARCIA,
  LUIS PEREZ`; acepta tabuladores, `;`, franjas `19-21`, fechas `d/m/aa`…).

Antes de guardar hay una **previsualización**: líneas que no se entienden,
duplicados de lo que ya estaba, y los **nombres dudosos**, que eliges tú
(sugiere "¿quizá es…?" para erratas como *Daneil*→*Daniel*, con **✨ Aceptar
sugerencias claras**; quien ya no está en tu lista se puede **crear como voluntario
inactivo** para que su historia cuente, o se omite). Al terminar se puede **↩︎
deshacer** toda la importación. Solo admite meses anteriores al actual.

**Turnos que no salieron adelante.** Las franjas que aparecen en blanco en el
programa (nadie se apuntó) se guardan como *sin cubrir*, y en la previsualización
puedes marcar un turno con gente como *no salió adelante* (por bajas, otro motivo).
También en texto: `14/06/2026 12-14 sin voluntarios` o `… cancelado`. Se guardan en
la tabla `turnos_no_realizados` (hay que ejecutar antes
[`supabase/03_turnos_no_realizados.sql`](supabase/03_turnos_no_realizados.sql); sin
ella se importan solo las asignaciones). Con ellas las estadísticas calculan
**qué porcentaje de los turnos programados salen adelante**, por qué no salen
(sin voluntarios / bajas / otros) y **qué días y franjas se quedan más veces sin
cubrir** (✖ en el mapa día × franja), con recomendaciones concretas.

### Bajas que solo se recuerdan ("al menos N")

Si de un mes gestionado a mano no se conservan las bajas una a una, pero se sabe que
hubo **al menos** un número (p. ej. "en abril hubo al menos 2"), se indica en
*🩺 Calidad de los datos → ✎ Indicar bajas*. Se guarda en la tabla
`ajustes_estadisticas` ([`supabase/04_ajustes_estadisticas.sql`](supabase/04_ajustes_estadisticas.sql)).
Las estadísticas lo tratan como **dato aproximado**: solo suma lo que falte hasta ese
mínimo (si el mes ya tiene más bajas registradas, no cambia nada), el mes pasa a contar
para la tasa de baja y las cifras salen como **"≥"** (bajas, tasa, y el aviso de tasa
habla de "al menos"). No inventa turnos, personas ni antelación: solo un número.

### Confirmar turnos desde Apuntes

Cada turno de *Apuntes* tiene **✓ Confirmar turno con estos apuntes**: añade a los
apuntados al equipo (historial), de modo que un turno formado solo por apuntes pasa
a ser un turno confirmado real (cuadrante, PDF, descansos y estadísticas). Quienes
ya están en el equipo se marcan como *✓ EN EL EQUIPO*. En las estadísticas ese
turno sigue contando como "salido adelante por apuntes".

### Dar de baja del grupo (Voluntarios)

Cada voluntario activo tiene **🚪 Dar de baja**: deja de aparecer en el
cuadrante, en la disponibilidad, en el balance y entre los sustitutos sugeridos,
pero **conserva todo su historial** para las estadísticas y se puede reactivar
(filtro **🚪 Inactivos → ♻️ Reactivar**). Si tiene turnos o apuntes por delante,
se ofrece quitarlo también de ellos. **🗑️ Eliminar** solo está disponible para un
inactivo que no consta en ningún turno, baja ni apunte (se comprueba en directo);
si consta, se queda inactivo para no falsear las estadísticas. El filtro **💤 Sin
actividad** reúne a quienes dejaron de participar o nunca empezaron.

## Configuración

Las credenciales van embebidas en cada HTML (constantes al inicio del `<script>`):

- **Supabase**: se usa la clave *publishable* (anónima). La seguridad depende de tener
  bien configuradas las políticas RLS en Supabase.
- **Google Apps Script**: `APP_URL` en `disponibilidad.html` (y la lógica de servidor
  vive en el propio proyecto de Apps Script, fuera de este repo).
- **Telegram** (opcional): el token del bot y el chat ID los introduce el usuario en
  el panel de notificaciones; se guardan solo en `localStorage`, no en el repo. Esos
  campos solo sirven para probar el bot — el envío real en segundo plano usa su propia
  copia de las credenciales como *secrets* de la Edge Function (ver más abajo).

## App instalable (PWA) y notificaciones en segundo plano

`planificador.html` se puede instalar en el móvil (Android/Chrome → "Añadir a
pantalla de inicio"): icono propio, pantalla completa. `manifest.webmanifest` y
`sw.js` son archivos estáticos reales — necesario para que la instalación sea
fiable (antes se generaban como *blob URLs* efímeras, que Chrome ni siquiera
acepta para registrar un service worker).

Las notificaciones de bajas y apuntes nuevos, para que lleguen **aunque la app
esté cerrada**, no pueden depender del navegador (ningún sondeo desde JS de
página sobrevive a que Android mate la pestaña en segundo plano). Por eso el
aviso a Telegram lo dispara Supabase directamente al insertarse la fila —
`supabase/functions/notificar-telegram/` + dos Database Webhooks. Se despliega
entero desde el panel de Supabase, sin CLI. Guía paso a paso:
[`NOTIFICACIONES.md`](NOTIFICACIONES.md), que incluye además:

- **Avisos de cancelación** (apunte cancelado, baja anulada) gracias al registro
  de actividad (`supabase/01_actividad.sql`).
- **Aviso de turno en riesgo**: cada hora revisa los turnos de las próximas 48 h y
  avisa por Telegram de los que no llegan al mínimo, sin repetirse
  (`supabase/functions/avisos-turnos` + `supabase/02_avisos.sql`).

## Pruebas

El motor global tiene un banco de pruebas que carga el `<script>` de
`planificador.html` en un DOM simulado y lo ejercita con escenarios sintéticos
(reparto de cobertura, cascada de descanso, portador de llave, ventana de carga,
franjas habilitadas, mes completo):

```bash
node test/motor-global.test.js
```

Incluye además el modelo de la vista *En vivo* y de la ficha de voluntario. La
función `avisos-turnos` tiene su propia prueba, que carga el `index.ts` tal cual
con Supabase, Telegram y el reloj simulados (autorización, horario, no repetir,
"ya cubierto", cambio horario):

```bash
node test/avisos-turnos.test.js
```

## Despliegue

Son ficheros estáticos: sirve la carpeta con cualquier hosting estático
(GitHub Pages, Netlify, etc.) o abre los `.html` directamente. `planificador.html` y
`sustituciones.html` registran un service worker en línea para funcionar como PWA
instalable.
