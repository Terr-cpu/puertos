# Notificaciones de bajas y apuntes — cómo funcionan y cómo activarlas

## El problema que resuelve esto

Antes, el aviso de "alguien ha comunicado una baja" o "alguien se ha apuntado"
se generaba **desde el propio navegador**: `planificador.html` sondeaba
Supabase cada 60 segundos mientras la página estaba abierta, y desde ahí
mandaba el mensaje de Telegram. En cuanto cerrabas la app, bloqueabas el
móvil un rato, o Android mataba la pestaña en segundo plano (todos los
fabricantes lo hacen para ahorrar batería — Xiaomi/Huawei/Samsung de forma
especialmente agresiva), el sondeo se paraba y no llegaba nada más. Esto es
así en **cualquier** sitio web que dependa de JavaScript de página para
avisar — no es un fallo puntual, es la naturaleza del mecanismo.

**La solución:** que sea **Supabase** quien mande el aviso a Telegram, en el
momento exacto en que se guarda la fila en la base de datos — sin pasar por
tu navegador para nada. Así llega igual con el móvil bloqueado o la app
cerrada.

Esto se hace con dos piezas de Supabase, ambas configurables desde su panel
web (no hace falta instalar nada ni usar la terminal):

1. **Una Edge Function** (`supabase/functions/notificar-telegram/index.ts`,
   ya escrita en este repo) — recibe el aviso de Supabase y llama a la API
   de Telegram.
2. **Dos Database Webhooks** — le dicen a Supabase "cuando se inserte una
   fila en `bajas` (o en `refuerzos`), llama a esa función".

## Paso 1 — Crear tu bot de Telegram (si no lo tienes ya)

1. Habla con [@BotFather](https://t.me/BotFather) en Telegram → `/newbot` →
   sigue los pasos → te da un **token** (algo como `123456789:AAbc...`).
2. Habla con tu bot nuevo (dile "hola" o `/start`) para que sepa quién eres.
3. Habla con [@userinfobot](https://t.me/userinfobot) para obtener tu
   **Chat ID** (un número).
4. Opcional: pega ambos datos en **Planificador → 🔔 (campana) → Configurar
   → Telegram** y pulsa **📤 Enviar prueba** para confirmar que el bot
   funciona. Esos campos solo sirven para esta prueba — el envío real de
   Supabase usa su propia copia del token (paso 3).

## Paso 2 — Publicar la Edge Function

1. Entra en tu proyecto de [supabase.com](https://supabase.com/dashboard).
2. Menú lateral → **Edge Functions** → **Create a new function**.
3. Nómbrala exactamente `notificar-telegram`.
4. Borra el código de ejemplo que trae por defecto y pega el contenido
   completo de
   [`supabase/functions/notificar-telegram/index.ts`](supabase/functions/notificar-telegram/index.ts)
   de este repositorio.
5. **Deploy**.
6. Dentro de la función → pestaña **Secrets** (o **Settings**) → añade:
   - `TELEGRAM_BOT_TOKEN` = el token del paso 1
   - `TELEGRAM_CHAT_ID` = tu Chat ID del paso 1

   (`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya están disponibles
   automáticamente en toda Edge Function, no hace falta añadirlas.)

## Paso 3 — Crear los dos Database Webhooks

1. Menú lateral → **Database** → **Webhooks** → **Create a new webhook**.
2. **Webhook 1 — bajas**
   - Name: `Baja nueva → Telegram`
   - Table: `bajas`
   - Events: marca solo **Insert**
   - Type: **Supabase Edge Functions**
   - Edge Function: `notificar-telegram`
   - HTTP method: `POST` (por defecto)
   - Guardar.
3. **Webhook 2 — refuerzos**
   - Name: `Apunte nuevo → Telegram`
   - Table: `refuerzos`
   - Events: solo **Insert**
   - Type: **Supabase Edge Functions** → `notificar-telegram`
   - Guardar.

Al elegir el tipo "Supabase Edge Functions" (en vez de "HTTP Request"),
Supabase añade la autenticación necesaria automáticamente — no hay que tocar
cabeceras a mano.

## Paso 4 — Probar

- Desde el móvil (o desde `sustituciones.html` en cualquier navegador),
  comunica una baja de prueba o apúntate a un turno.
- En unos segundos debería llegar el mensaje de Telegram, **aunque
  `planificador.html` esté completamente cerrado**.
- Si no llega: Supabase → Edge Functions → `notificar-telegram` → pestaña
  **Logs**, para ver si la función se ejecutó y qué error dio (token/chat ID
  mal puestos, tabla inesperada, etc.).

## Ampliación A — Registro de actividad y avisos de cancelación

Con lo anterior te avisa cuando alguien **se da de baja** o **se apunta**. Lo que no
avisaba (ni dejaba rastro con hora en ninguna tabla) es lo contrario: un **apunte
cancelado**, una **baja anulada** o alguien **quitado de un turno**. Esto lo resuelve.

1. Supabase → **SQL Editor** → New query → pega el contenido de
   [`supabase/01_actividad.sql`](supabase/01_actividad.sql) → **Run**. Crea la tabla
   `actividad` y unos disparadores que anotan, con hora, cada alta/baja de apuntes,
   bajas y equipos, lo haga quien lo haga y aunque la app esté cerrada. También hace
   que una baja que se **vuelve a registrar** sobre otra anulada cuente como nueva
   (antes no generaba aviso, porque el sistema la trataba como una modificación).
2. **Edge Functions → `notificar-telegram`** → pega de nuevo el código actualizado de
   [`index.ts`](supabase/functions/notificar-telegram/index.ts) → Deploy.
3. **Database → Webhooks**:
   - Edita el webhook de **`bajas`** y marca también **Update** (además de Insert).
   - Crea uno nuevo: tabla **`actividad`**, evento **Insert**, tipo *Supabase Edge
     Functions* → `notificar-telegram`. (Solo genera aviso para *apunte cancelado* y
     *baja anulada*; lo demás ya tenía el suyo.)
4. Comprobar: cancela un apunte de prueba desde Sustituciones → llega
   "❌ Apunte cancelado". En **🛰️ En vivo** dejará de salir el aviso de que las
   cancelaciones "se detectan solo desde este navegador": ahora salen siempre.

El registro guarda 90 días (lo limpia la tarea del paso B).

## Ampliación B — Aviso de "turno en riesgo"

Cada hora, Supabase revisa los turnos de las **próximas 48 h** y te avisa por
Telegram de los que no llegan al mínimo de voluntarios, con quién hay, quién dio
baja y el enlace a Sustituciones. No repite el aviso: solo vuelve a escribir si
cambia la situación (alguien se apunta o se da de baja), y te dice "✅ Ya cubierto"
cuando se resuelve. No escribe entre las 22:00 y las 08:00 (hora de Madrid).

1. **Edge Functions → Create a new function** → nómbrala exactamente
   `avisos-turnos` → pega el contenido de
   [`supabase/functions/avisos-turnos/index.ts`](supabase/functions/avisos-turnos/index.ts)
   (un solo archivo) → Deploy.
2. En esa función, **desactiva "Verify JWT"** (Details/Settings). Queda protegida por
   una clave propia (siguiente paso), no por el JWT.
3. **Secrets** de esa función (los de Telegram ya los tienes en la otra; hay que
   repetirlos aquí porque cada función tiene los suyos):
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   - `CRON_SECRET` = un texto largo cualquiera (inventado por ti)
   - opcionales: `MIN_EQ` (mínimo por turno, 3 por defecto) y `HORIZONTE_H` (48).
4. **SQL Editor** → abre [`supabase/02_avisos.sql`](supabase/02_avisos.sql), cambia
   `CAMBIA_ESTE_SECRETO` por el mismo texto de `CRON_SECRET` y ejecútalo. Crea la
   tabla `avisos_enviados` y programa la tarea horaria.
5. **Probar sin esperar a la hora en punto**, con la función en modo simulación
   (no envía nada, solo muestra qué avisaría):

   ```bash
   curl -X POST "https://inifdflvblnonzowbxie.supabase.co/functions/v1/avisos-turnos?dry=1" -H "x-cron-secret: TU_SECRETO"
   ```

   Para un aviso real, la misma llamada sin `?dry=1` (dentro de 08:00–21:59).
   **Turnos anulados.** Si en el planificador anulas un turno (Bajas → 🚫 Anular
   turno), esta función deja de avisar de él. Si ya la tenías desplegada, **vuelve
   a pegar el código actualizado** de `index.ts` y pulsa Deploy (necesita la tabla
   de la Ampliación C; si aún no existe, la ignora).
6. Si algo falla: Edge Functions → `avisos-turnos` → **Logs**, y en SQL:
   `select * from net._http_response order by id desc limit 5;`

## Ampliación C — Turnos que no salieron adelante (para las estadísticas)

Al importar cuadrantes de meses anteriores (Estadísticas → 📥 Importar turnos
anteriores), las franjas en blanco o canceladas se guardan en una tabla propia.

1. Supabase → **SQL Editor** → New query → pega el contenido de
   [`supabase/03_turnos_no_realizados.sql`](supabase/03_turnos_no_realizados.sql) →
   **Run**. Crea la tabla `turnos_no_realizados` (solo fechas y franjas, sin nombres).
2. Comprobar: `select * from public.turnos_no_realizados;` debe devolver 0 filas sin error.

Sin este paso, la importación sigue funcionando pero solo guarda las asignaciones
(la ventana de importación lo avisa).

## Ampliación D — Bajas que solo se recuerdan (mínimo por mes)

Para indicar "en abril hubo al menos 2 bajas" sin saber cuáles (Estadísticas →
🩺 Calidad de los datos → ✎ Indicar bajas).

1. Supabase → **SQL Editor** → New query → pega
   [`supabase/04_ajustes_estadisticas.sql`](supabase/04_ajustes_estadisticas.sql) → **Run**.
   Crea la tabla `ajustes_estadisticas` (un mes, un número y una nota).
2. Comprobar: `select * from public.ajustes_estadisticas;` debe devolver 0 filas sin error.

Sin este paso, el botón "Indicar bajas" te avisa de que falta la tabla.

## Ampliación E — Apuntes y bajas de meses hechos solo con apuntes (Telegram)

Para meses como julio y agosto, gestionados con el formulario de **apuntes** de
Sustituciones y sin cuadrante, los avisos que el bot te mandó a Telegram guardan quién
se apuntó y quién se dio de baja. La app los lee del chat exportado.

1. Supabase → **SQL Editor** → New query → pega
   [`supabase/05_archivo_apuntes_bajas.sql`](supabase/05_archivo_apuntes_bajas.sql) → **Run**.
   Crea `apuntes_archivo` y `bajas_archivo`. Son tablas aparte a propósito: `refuerzos`
   y `bajas` disparan avisos a Telegram y no quieres un mensaje por cada apunte antiguo.
2. En **Telegram Desktop**: abre el chat del bot → ⋮ → **Exportar historial del chat** →
   marca solo *Mensajes de texto* → formato **JSON** → Exportar.
3. En la app: **📈 Estadísticas → 💬 Desde Telegram** → elige el `result.json`. Revisa la
   vista previa (apuntes y bajas nuevos, cuáles ya existían, cuántos turnos llegan a 3),
   asigna a quién corresponde cada nombre dudoso y pulsa **Importar**. Se puede
   **deshacer** desde la misma ventana.

Límites que conviene saber:
- Solo se importan turnos **anteriores al mes en curso** (los actuales ya están en la app).
- La hora de cada apunte/baja es la del **aviso**, que puede retrasarse si la app estaba cerrada.
- Antes de septiembre, cancelar un apunte o anular una baja no mandaba aviso, así que esos
  apuntes figurarán como apuntados.
- Con esto, un turno hecho solo con apuntes cuenta como turno que salió adelante si reúne
  `MIN_EQ` (3) o más voluntarios, y quienes asistieron suman en sus estadísticas.

## Qué queda igual

- Las notificaciones del navegador (🔔 campanita, panel de actividad dentro
  del planificador) siguen funcionando igual que antes, mientras tengas la
  app abierta — son un canal aparte, complementario.
- `planificador.html` instalado como PWA (icono en pantalla de inicio,
  pantalla completa) sigue funcionando igual; el manifest y el service
  worker ahora son archivos reales (`manifest.webmanifest`, `sw.js`) en vez
  de generarse al vuelo, lo que hace la instalación en Android más fiable.

## Si algún día quieres notificaciones nativas con el icono de la app

En vez de (o además de) Telegram, existe **Web Push**: notificaciones del
sistema con el nombre e icono de "Turnos Puerto" en vez de llegar como
mensaje de Telegram. Necesita generar un par de claves VAPID, guardar la
"suscripción" push de tu móvil en Supabase, y que `notificar-telegram` (o
una función hermana) llame al endpoint de push en vez de a Telegram. Es más
trabajo de configurar y, en algunos móviles con gestión de batería muy
agresiva, menos fiable que Telegram. Si lo quieres más adelante, dímelo y lo
montamos.
