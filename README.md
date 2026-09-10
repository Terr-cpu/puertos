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
calendario de días activos. Parámetros configurables en la pestaña **Reglas del motor**
(se guardan en `localStorage` con la clave `reglas_cuadrante`):

- `DESC_OK` — días de descanso mínimo ideal entre turnos (por defecto 5)
- `DESC_MIN` — días de descanso mínimo absoluto (2)
- `IDEAL` — voluntarios ideales por turno (4)
- `MIN_EQ` — mínimo aceptable por turno (3)
- `DUR` — duración del turno en horas (2)

Se pueden definir excepciones por día concreto (clave `excepcion_dia` en `localStorage`).

## Configuración

Las credenciales van embebidas en cada HTML (constantes al inicio del `<script>`):

- **Supabase**: se usa la clave *publishable* (anónima). La seguridad depende de tener
  bien configuradas las políticas RLS en Supabase.
- **Google Apps Script**: `APP_URL` en `disponibilidad.html` (y la lógica de servidor
  vive en el propio proyecto de Apps Script, fuera de este repo).
- **Telegram** (opcional): el token del bot y el chat ID los introduce el usuario en
  el panel de notificaciones; se guardan solo en `localStorage`, no en el repo.

## Despliegue

Son ficheros estáticos: sirve la carpeta con cualquier hosting estático
(GitHub Pages, Netlify, etc.) o abre los `.html` directamente. `planificador.html` y
`sustituciones.html` registran un service worker en línea para funcionar como PWA
instalable.
