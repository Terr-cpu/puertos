// ══════════════════════════════════════════════════════════════
//  cuenta-voluntario — Supabase Edge Function
//  ────────────────────────────────────────────────────────────
//  Hace fácil la primera vez en la pantalla de entrada (index.html): el
//  voluntario escribe su correo y la página pregunta aquí qué toca:
//
//   { accion: 'estado', email }           → { estado: 'sin_ficha' | 'nueva' | 'existente' }
//       sin_ficha: el correo no está en ninguna ficha de voluntario activo
//       nueva:     está en una ficha pero aún no tiene cuenta → "crea tu contraseña"
//       existente: ya tiene cuenta → "escribe tu contraseña"
//
//   { accion: 'crear', email, password }  → { ok: true } | { error }
//       Crea la cuenta YA CONFIRMADA (sin correo de confirmación) y la página
//       entra a continuación con esa contraseña. Solo si el correo está en una
//       ficha activa y todavía no tiene cuenta (no sirve para cambiar la contraseña
//       de nadie: eso es "Recordar contraseña", que va por correo).
//
//  Despliegue: Edge Functions → nombre exacto "cuenta-voluntario" → pegar este
//  archivo → Deploy, con "Verify JWT" DESACTIVADO (se llama antes de tener sesión).
//  Variables: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (automáticas).
//  Un solo archivo a propósito: se pega tal cual en el editor del panel de Supabase.
// ══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CLAVE_MIN = 8;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

/** Correo normalizado, o null si no parece un correo. Lógica pura. */
function normalizarEmail(e: unknown): string | null {
  const s = String(e ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254 ? s : null;
}

/** ¿Hay una ficha de voluntario ACTIVO con ese correo? */
async function tieneFicha(email: string): Promise<boolean> {
  // ilike y luego comparación exacta (un "_" del correo haría de comodín)
  const { data, error } = await sb.from('voluntarios').select('email,activo').ilike('email', email);
  if (error) throw new Error(error.message);
  return (data || []).some((v: any) => v.activo && String(v.email || '').trim().toLowerCase() === email);
}

/** ¿Ya tiene cuenta? (la API de admin no busca por correo: se recorren las páginas; son pocos) */
async function cuentaExiste(email: string): Promise<boolean> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = data?.users || [];
    if (users.some((u: any) => String(u.email || '').toLowerCase() === email)) return true;
    if (users.length < 1000) return false;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'metodo' }, 405);

  let payload: any = {};
  try { payload = await req.json(); } catch { /* body vacío */ }
  const email = normalizarEmail(payload?.email);
  if (!email) return json({ error: 'correo_invalido' }, 400);

  try {
    if (payload?.accion === 'estado') {
      if (!(await tieneFicha(email))) return json({ estado: 'sin_ficha' });
      return json({ estado: (await cuentaExiste(email)) ? 'existente' : 'nueva' });
    }

    if (payload?.accion === 'crear') {
      const password = String(payload?.password ?? '');
      if (password.length < CLAVE_MIN) return json({ error: 'clave_corta', min: CLAVE_MIN }, 400);
      if (!(await tieneFicha(email))) return json({ error: 'sin_ficha' }, 404);
      const { error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) return json({ error: 'existente' }, 409);
        throw new Error(error.message);
      }
      return json({ ok: true });
    }

    return json({ error: 'accion' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'error', detalle: (e as Error).message }, 500);
  }
});
