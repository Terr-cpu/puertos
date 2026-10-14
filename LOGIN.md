# Login — cómo activarlo

`asispuerto.org` pasa a ser una pantalla de entrada. **Todos entran con correo y
contraseña**, pero sin trámites:

1. Escriben **el correo de su ficha** y pulsan *Continuar*.
2. **La primera vez**, la propia pantalla les pide *"Crea tu contraseña"* (dos veces) y
   entran al momento: sin "crear cuenta" aparte ni correo de confirmación.
   **Las siguientes**, les pide su contraseña.
3. Casilla **"Mantener la sesión iniciada"** (marcada por defecto): no tienen que
   volver a entrar en ese móvil. Desmarcada, la sesión se cierra al cerrar el navegador.
4. **"Recordar contraseña"**: les llega un correo para elegir otra.

Tú solo tienes que guardar el correo de cada uno en su ficha (Voluntarios → Ficha →
💾). Si un correo no está en ninguna ficha de voluntario activo, no puede entrar ni
crear contraseña.

- **El admin (tú)** va al **planificador**, donde nadie más puede entrar.
- **El voluntario** va a **su menú** (`inicio.html`): comunicar una baja, apuntarse a
  turnos, su disponibilidad, sus próximos turnos con sus compañeros y cambiar su
  contraseña. En Sustituciones y Disponibilidad ya no escribe su nombre.

**Lo que se acepta a cambio de la comodidad:** como la primera contraseña no se
confirma por correo, alguien que sepa el correo de un voluntario que **todavía no ha
entrado nunca** podría adelantarse y ponerle contraseña. Si pasa, el voluntario lo
resuelve con "Recordar contraseña", y en Authentication → Users ves cuándo se creó
cada cuenta.

**Seguridad de la base de datos.** Ocultar el planificador tras un login no basta:
la clave pública de Supabase está en el código de las páginas y, con los permisos
de antes, cualquiera podía leer y modificar las tablas directamente. Por eso hay
dos fases: la 1 añade el login y la 2 cierra la base de datos.

| Archivo | Para qué |
|---|---|
| [`auth.js`](auth.js) | Sesión compartida por todas las páginas |
| [`index.html`](index.html) | Pantalla de entrada (voluntario y coordinador) |
| [`inicio.html`](inicio.html) | Menú del voluntario |
| [`supabase/functions/cuenta-voluntario`](supabase/functions/cuenta-voluntario/index.ts) | Primera vez: dice si el correo está en una ficha y si ya tiene contraseña, y la crea |
| [`supabase/13_login.sql`](supabase/13_login.sql) | Fase 1: quién es admin y quién voluntario; solo hay cuentas para correos de fichas |
| [`supabase/14_cerrar_bd.sql`](supabase/14_cerrar_bd.sql) | Fase 2: permisos de verdad en cada tabla |
| [`supabase/correos-login/`](supabase/correos-login) | Plantilla en español del correo de "Recordar contraseña" |

## Fase 1 — Preparar Supabase

1. **SQL Editor** → pega [`supabase/13_login.sql`](supabase/13_login.sql) → **Run**. *(Hecho.)*
2. **Edge Functions → Create a new function** → nómbrala exactamente
   `cuenta-voluntario` → pega
   [`index.ts`](supabase/functions/cuenta-voluntario/index.ts) → Deploy, y desactiva
   **Verify JWT** (se llama antes de tener sesión). Si llegaste a crear
   `entrar-voluntario`, bórrala. *(Hecho. Ojo: el panel le asignó la dirección
   `smooth-task`; es la que llama `index.html`, en `FUNCION_CUENTA`. Si algún día la
   vuelves a crear, cambia ahí el nombre.)*
3. **Authentication → URL Configuration** *(hecho)*:
   Site URL `https://asispuerto.org`; Redirect URLs `https://asispuerto.org/**` y
   `http://127.0.0.1:8766/**`.
4. **Authentication → Emails → SMTP** con Resend *(hecho)*. Se usa para el correo de
   "Recordar contraseña".
5. **Templates → Reset password**: asunto `Contraseña nueva — Turnos Puerto`, cuerpo
   [`recuperar-contrasena.html`](supabase/correos-login/recuperar-contrasena.html).
   La plantilla de "Confirm signup" ya no se usa.
6. Tu cuenta de admin *(hecho)*: creada con contraseña y con `rol = admin`.

## Probar (antes de publicar)

Las páginas nuevas están en la rama `login`, así que la web publicada no cambia
hasta fusionarla con `main`. Se prueban en local en `http://127.0.0.1:8766/`.

- **Voluntario**: pon otro correo tuyo en una ficha de prueba, escríbelo → te pide
  crear contraseña → entras al menú. Comprueba Sustituciones y Disponibilidad, cierra
  sesión y vuelve a entrar (ahora te pide la contraseña).
- **Coordinador**: tu correo → tu contraseña → planificador.

## Publicar

Al fusionar la rama `login` con `main`, GitHub Pages publica el login en
`asispuerto.org`. **A partir de ese momento cada voluntario necesita tener su
correo en su ficha** para comunicar bajas o apuntarse, también desde los enlaces
que ya circulan por WhatsApp. Antes de publicar, guarda los correos y avisa en el
grupo: *"Desde hoy se entra por asispuerto.org con vuestro correo."*

## Fase 2 — Cerrar la base de datos (después de publicar)

1. **SQL Editor** → pega [`supabase/14_cerrar_bd.sql`](supabase/14_cerrar_bd.sql) → **Run**.
2. **Edge Functions → `notificar-email`** → pega su `index.ts` nuevo → Deploy. Así el
   recibo de disponibilidad solo lo puede pedir el propio voluntario o el admin.
3. Comprueba que el planificador, Sustituciones y Disponibilidad siguen funcionando.
   Si algo falla y hace falta tiempo para arreglarlo, al final de
   `14_cerrar_bd.sql` hay un bloque de **emergencia** que lo vuelve a abrir todo.

## Preguntas habituales

- **"Este correo no está en ninguna ficha"**: el voluntario ha escrito un correo
  distinto del de su ficha, o su ficha no tiene correo, o está inactiva.
- **Cambiar el correo de un voluntario**: cámbialo en su ficha **y** en
  Authentication → Users (o borra allí su cuenta antigua y que vuelva a crear
  contraseña con el correo nuevo).
- **Un voluntario no recuerda su contraseña**: "Recordar contraseña" en la pantalla
  de entrada. Si no le llega el correo, borra su cuenta en Authentication → Users y
  que vuelva a entrar como si fuera la primera vez.
- **Dar de baja a un voluntario** (ficha inactiva): ya no puede entrar, y si tenía
  la sesión abierta deja de poder usar las páginas.
