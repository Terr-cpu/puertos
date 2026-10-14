// ══════════════════════════════════════════════════════════════
//  entrar-voluntario — Supabase Edge Function
//  ────────────────────────────────────────────────────────────
//  Acceso de los voluntarios SOLO con el correo (sin contraseña ni código):
//  index.html manda { email } y, si ese correo está en la ficha de un voluntario
//  activo, la función devuelve un token de un solo uso con el que la página abre
//  una sesión normal de Supabase (verifyOtp). La primera vez crea la cuenta.
//
//  Decisión del coordinador: es lo más fácil para los voluntarios, a cambio de
//  que quien sepa el correo de otro voluntario pueda entrar como él. Lo que puede
//  hacer un voluntario está limitado a lo suyo (supabase/14_cerrar_bd.sql).
//
//  Las cuentas de ADMIN nunca entran por aquí (aunque su correo esté en una
//  ficha): solo con contraseña, desde "Acceso coordinador".
//
//  Despliegue: Edge Functions → nombre exacto "entrar-voluntario" → pegar este
//  archivo → Deploy, con "Verify JWT" DESACTIVADO (se llama antes de tener sesión).
//  Variables: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (automáticas).
//  Un solo archivo a propósito: se pega tal cual en el editor del panel de Supabase.
// ══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
  // ilike sin comodines efectivos: luego se compara exacto (un "_" del correo sería comodín)
  const { data, error } = await sb.from('voluntarios').select('email,activo').ilike('email', email);
  if (error) throw new Error(error.message);
  return (data || []).some((v: any) => v.activo && String(v.email || '').trim().toLowerCase() === email);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'metodo' }, 405);

  let payload: any = {};
  try { payload = await req.json(); } catch { /* body vacío */ }
  const email = normalizarEmail(payload?.email);
  if (!email) return json({ error: 'correo_invalido' }, 400);

  try {
    if (!(await tieneFicha(email))) return json({ error: 'sin_ficha' }, 404);

    // La primera vez, crear la cuenta (ya confirmada: no se manda ningún correo).
    // Si ya existe, Supabase responde "ya registrado" y se sigue.
    const { error: errAlta } = await sb.auth.admin.createUser({ email, email_confirm: true });
    if (errAlta && !/already|registered|exists/i.test(errAlta.message)) throw new Error(errAlta.message);

    const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data?.properties?.hashed_token) throw new Error(error?.message || 'sin token');

    // El admin solo entra con contraseña: no se le da el token aunque su correo esté en una ficha
    if (data.user?.app_metadata?.rol === 'admin') return json({ error: 'admin' }, 403);

    return json({ token_hash: data.properties.hashed_token });
  } catch (e) {
    console.error(e);
    return json({ error: 'error', detalle: (e as Error).message }, 500);
  }
});
