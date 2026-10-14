# Login — cómo activarlo

`asispuerto.org` pasa a ser una pantalla de entrada:

- **Voluntarios: solo con el correo.** Escriben el correo de su ficha y entran, sin
  contraseña ni código. La sesión se queda guardada en su móvil. La primera vez se
  les crea la cuenta solos; tú solo tienes que guardar su correo en la ficha
  (Voluntarios → Ficha → 💾). Entran a **su menú** (`inicio.html`): comunicar una
  baja, apuntarse a turnos, su disponibilidad y sus próximos turnos con sus
  compañeros. En Sustituciones y Disponibilidad ya no escriben su nombre.
- **El coordinador (admin): correo y contraseña**, desde "Acceso coordinador", abajo
  en la pantalla de entrada. Va al **planificador**, donde nadie más puede entrar.
  Una cuenta de admin **nunca** entra solo con el correo, aunque ese correo esté
  también en una ficha de voluntario.

**Lo que se acepta a cambio de la comodidad:** quien sepa el correo de otro
voluntario puede entrar como él, y darle de baja o apuntarle. No puede tocar nada
del cuadrante ni de otros voluntarios; eso solo lo puede hacer el admin.

**Seguridad de la base de datos.** Ocultar el planificador tras un login no basta:
la clave pública de Supabase está en el código de las páginas y, con los permisos
de antes, cualquiera podía leer y modificar las tablas directamente. Por eso hay
dos fases: la 1 añade el login y la 2 cierra la base de datos.

| Archivo | Para qué |
|---|---|
| [`auth.js`](auth.js) | Sesión compartida por todas las páginas |
| [`index.html`](index.html) | Pantalla de entrada (voluntario y coordinador) |
| [`inicio.html`](inicio.html) | Menú del voluntario |
| [`supabase/functions/entrar-voluntario`](supabase/functions/entrar-voluntario/index.ts) | Abre la sesión de un voluntario con solo su correo |
| [`supabase/13_login.sql`](supabase/13_login.sql) | Fase 1: quién es admin y quién voluntario; solo hay cuentas para correos de fichas |
| [`supabase/14_cerrar_bd.sql`](supabase/14_cerrar_bd.sql) | Fase 2: permisos de verdad en cada tabla |
| [`supabase/correos-login/`](supabase/correos-login) | Plantilla en español del correo de contraseña nueva (solo coordinador) |

## Fase 1 — Preparar Supabase

1. **SQL Editor** → pega [`supabase/13_login.sql`](supabase/13_login.sql) → **Run**. *(Hecho.)*
2. **Edge Functions → Create a new function** → nómbrala exactamente
   `entrar-voluntario` → pega
   [`index.ts`](supabase/functions/entrar-voluntario/index.ts) → Deploy, y desactiva
   **Verify JWT** (se llama antes de tener sesión).
3. **Authentication → URL Configuration** *(hecho)*:
   Site URL `https://asispuerto.org`; Redirect URLs `https://asispuerto.org/**` y
   `http://127.0.0.1:8766/**`.
4. **Authentication → Emails → SMTP** con Resend *(hecho)*. Solo se usa ya para el
   correo de "contraseña nueva" del coordinador.
5. **Templates → Reset password**: asunto `Contraseña nueva — Turnos Puerto`, cuerpo
   [`recuperar-contrasena.html`](supabase/correos-login/recuperar-contrasena.html).
   La plantilla de "Confirm signup" ya no se usa.
6. Tu cuenta de admin *(hecho)*: creada con contraseña y con `rol = admin`.

## Probar (antes de publicar)

Las páginas nuevas están en la rama `login`, así que la web publicada no cambia
hasta fusionarla con `main`. Se prueban en local en `http://127.0.0.1:8766/`.

- **Voluntario**: pon otro correo tuyo en una ficha de prueba, escríbelo en
  "Entrar" y comprueba el menú, Sustituciones y Disponibilidad.
- **Coordinador**: "Acceso coordinador" → tu correo y contraseña → planificador.
  Si escribes tu correo en la caja de voluntario, te pasa al acceso de coordinador.

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
- **Cambiar el correo de un voluntario**: cámbialo en su ficha. La próxima vez que
  entre con el correo nuevo se le crea otra cuenta. Puedes borrar la antigua en
  Authentication → Users.
- **Dar de baja a un voluntario** (ficha inactiva): ya no puede entrar, y si tenía
  la sesión abierta deja de poder usar las páginas.
