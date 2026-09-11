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
