# Login — cómo activarlo

`asispuerto.org` pasa a ser una pantalla de entrada. Cada uno entra con su
correo y contraseña:

- **El admin** (el coordinador) va al **planificador**. Nadie más puede entrar en él.
- **Un voluntario** va a **su menú** (`inicio.html`): comunicar una baja, apuntarse a
  turnos, su disponibilidad y sus próximos turnos con sus compañeros. En
  Sustituciones y Disponibilidad ya no escribe su nombre: la página sabe quién es.

**Cuentas.** Cada voluntario crea la suya desde "Crear mi cuenta", con **el correo de
su ficha**. Un correo que no esté en ninguna ficha de voluntario activo no puede
registrarse. Para que alguien pueda entrar, basta con guardar su correo en su ficha
(Voluntarios → Ficha → 💾). Si olvida la contraseña, la recupera él mismo desde
"¿Olvidaste tu contraseña?".

**Seguridad de verdad.** Ocultar el planificador tras un login no basta: la clave
pública de Supabase está en el código de las páginas y, con los permisos de antes,
cualquiera podía leer y modificar las tablas directamente. Por eso hay dos fases:
la 1 añade el login sin cambiar los permisos, y la 2 cierra la base de datos.

| Archivo | Para qué |
|---|---|
| [`auth.js`](auth.js) | Sesión compartida por todas las páginas |
| [`index.html`](index.html) | Login: entrar, crear cuenta, recuperar contraseña |
| [`inicio.html`](inicio.html) | Menú del voluntario |
| [`supabase/13_login.sql`](supabase/13_login.sql) | Fase 1: quién es admin y quién es voluntario; solo se registran correos de fichas |
| [`supabase/14_cerrar_bd.sql`](supabase/14_cerrar_bd.sql) | Fase 2: permisos de verdad en cada tabla |
| [`supabase/correos-login/`](supabase/correos-login) | Plantillas en español de los correos de activar cuenta y de contraseña nueva |

## Fase 1 — Preparar Supabase (no cambia nada para nadie todavía)

1. **SQL Editor** → New query → pega [`supabase/13_login.sql`](supabase/13_login.sql) → **Run**.
2. **Authentication → Sign In / Providers → Email**: activado, con **Confirm email**
   activado. Pon la longitud mínima de contraseña en 8.
3. **Authentication → URL Configuration**:
   - **Site URL**: `https://asispuerto.org`
   - **Redirect URLs** (Add URL): `https://asispuerto.org/**` y, para las pruebas,
     `http://127.0.0.1:8766/**`
4. **Authentication → Emails → SMTP Settings** → *Enable custom SMTP*. Así los correos
   de la cuenta salen de tu dominio por Resend, en vez del servidor de pruebas de
   Supabase, que solo envía a los miembros del proyecto y muy pocos por hora:
   - Sender email: `avisos@asispuerto.org` · Sender name: `Turnos Puerto`
   - Host: `smtp.resend.com` · Port: `465`
   - Username: `resend` · Password: una API key de Resend (puede ser la misma de
     `RESEND_API_KEY`, o crea otra solo para esto)
5. **Authentication → Emails → Templates**:
   - **Confirm signup**: asunto `Activa tu cuenta — Turnos Puerto`; en el cuerpo pega
     [`confirmar-cuenta.html`](supabase/correos-login/confirmar-cuenta.html).
   - **Reset password**: asunto `Contraseña nueva — Turnos Puerto`; en el cuerpo pega
     [`recuperar-contrasena.html`](supabase/correos-login/recuperar-contrasena.html).

## Fase 1 — Probar (antes de publicar)

Las páginas nuevas están en la rama `login`; la web publicada no cambia hasta
fusionarla con `main`. Se prueban en local en `http://127.0.0.1:8766/`.

1. Abre `index.html` → **Crear mi cuenta** con tu correo (el de tu ficha) → confirma
   desde el correo que te llega.
2. Hazte admin: SQL Editor →
   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"rol":"admin"}'::jsonb
   where lower(email) = 'manuf.m@hotmail.com';
   ```
   Cierra sesión y vuelve a entrar: ahora vas al planificador.
3. Prueba como voluntario: pon otro correo tuyo en una ficha de prueba, crea la
   cuenta con él y comprueba el menú, Sustituciones y Disponibilidad.

## Publicar

Al fusionar la rama `login` con `main`, GitHub Pages publica el login en
`asispuerto.org`. **A partir de ese momento cada voluntario necesita cuenta** para
comunicar bajas o apuntarse, incluidos los enlaces que ya circulan por WhatsApp.
Antes de publicar, guarda los correos en las fichas y avisa en el grupo:
*"Entrad en asispuerto.org → Crear mi cuenta, con el correo que os pedimos."*

## Fase 2 — Cerrar la base de datos (después de publicar)

1. **SQL Editor** → pega [`supabase/14_cerrar_bd.sql`](supabase/14_cerrar_bd.sql) → **Run**.
2. **Edge Functions → `notificar-email`** → pega su `index.ts` nuevo → Deploy. Ahora el
   recibo de disponibilidad solo lo puede pedir el propio voluntario o el admin.
3. Comprueba que el planificador, Sustituciones y Disponibilidad siguen funcionando.
   Si algo falla y hace falta tiempo para arreglarlo, al final de
   `14_cerrar_bd.sql` hay un bloque de **emergencia** que lo vuelve a abrir todo.

## Preguntas habituales

- **"Este correo no está en ninguna ficha"**: el voluntario está usando un correo
  distinto del de su ficha, o su ficha no tiene correo, o está inactiva.
- **No le llega el correo de activar la cuenta**: que mire en spam. Si sigue sin
  llegar, Authentication → Users muestra si la cuenta existe y si está confirmada.
- **Cambiar el correo de un voluntario** que ya tiene cuenta: cámbialo en su ficha
  **y** en Authentication → Users. Si solo lo cambias en la ficha, al entrar ya no se
  le reconoce.
- **Dar de baja a un voluntario** (ficha inactiva): deja de poder usar las páginas
  aunque conserve su contraseña.
