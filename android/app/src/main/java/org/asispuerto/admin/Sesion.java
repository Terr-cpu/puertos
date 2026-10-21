package org.asispuerto.admin;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Sesión propia de los widgets con la cuenta de administrador (Supabase Auth).
 * Es independiente de la de la web que se ve dentro de la app: así, al renovar el
 * token aquí no se cierra la sesión del planificador, ni al revés.
 */
final class Sesion {
    static final String URL_SB = "https://inifdflvblnonzowbxie.supabase.co";
    static final String CLAVE = "sb_publishable_2PIBcSVgX-8gtQRLPILJlQ_AyCq3cIH";

    /** La sesión ya no vale (contraseña cambiada, sesión cerrada…): hay que volver a conectar. */
    static final class SinSesion extends Exception {
        SinSesion(String m) { super(m); }
    }

    private Sesion() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("sesion", Context.MODE_PRIVATE);
    }

    static boolean conectada(Context c) {
        return prefs(c).getString("refresh", null) != null;
    }

    static String email(Context c) {
        return prefs(c).getString("email", "");
    }

    /** Entrar con correo y contraseña. Solo se admite la cuenta de administrador. */
    static void iniciar(Context c, String email, String clave) throws Exception {
        JSONObject cuerpo = new JSONObject().put("email", email).put("password", clave);
        Respuesta r = peticion("POST", "/auth/v1/token?grant_type=password", null, cuerpo.toString());
        if (r.codigo == 400 || r.codigo == 401) throw new Exception("Correo o contraseña incorrectos");
        if (r.codigo >= 300) throw new Exception("No se pudo entrar (" + r.codigo + ")");
        JSONObject j = new JSONObject(r.cuerpo);
        JSONObject meta = j.optJSONObject("user") != null ? j.getJSONObject("user").optJSONObject("app_metadata") : null;
        if (meta == null || !"admin".equals(meta.optString("rol"))) {
            throw new Exception("Esta cuenta no es la del administrador");
        }
        guardar(c, j);
    }

    static void cerrar(Context c) {
        prefs(c).edit().clear().apply();
    }

    /** Token vigente; si ha caducado, lo renueva (una sola renovación a la vez). */
    static synchronized String token(Context c) throws Exception {
        SharedPreferences p = prefs(c);
        String refresh = p.getString("refresh", null);
        if (refresh == null) throw new SinSesion("Sin conectar");
        long caduca = p.getLong("caduca", 0);
        String acceso = p.getString("acceso", null);
        if (acceso != null && System.currentTimeMillis() / 1000 < caduca - 120) return acceso;
        JSONObject cuerpo = new JSONObject().put("refresh_token", refresh);
        Respuesta r = peticion("POST", "/auth/v1/token?grant_type=refresh_token", null, cuerpo.toString());
        if (r.codigo == 400 || r.codigo == 401 || r.codigo == 403) {
            cerrar(c);
            throw new SinSesion("La sesión de los widgets ha caducado");
        }
        if (r.codigo >= 300) throw new Exception("Error " + r.codigo + " al renovar la sesión");
        JSONObject j = new JSONObject(r.cuerpo);
        guardar(c, j);
        return j.getString("access_token");
    }

    private static void guardar(Context c, JSONObject j) throws Exception {
        long caduca = j.optLong("expires_at", System.currentTimeMillis() / 1000 + j.optLong("expires_in", 3600));
        String email = j.optJSONObject("user") != null ? j.getJSONObject("user").optString("email", "") : email(c);
        prefs(c).edit()
                .putString("acceso", j.getString("access_token"))
                .putString("refresh", j.getString("refresh_token"))
                .putLong("caduca", caduca)
                .putString("email", email)
                .apply();
    }

    /** GET a la API REST de Supabase con el token de la sesión. */
    static String get(Context c, String ruta) throws Exception {
        Respuesta r = peticion("GET", "/rest/v1/" + ruta, token(c), null);
        if (r.codigo == 401) {
            // Token rechazado: forzar renovación una vez
            prefs(c).edit().putLong("caduca", 0).apply();
            r = peticion("GET", "/rest/v1/" + ruta, token(c), null);
        }
        if (r.codigo >= 300) throw new Exception("Error " + r.codigo + " en " + ruta.split("\\?")[0]);
        return r.cuerpo;
    }

    static final class Respuesta {
        final int codigo;
        final String cuerpo;
        Respuesta(int codigo, String cuerpo) { this.codigo = codigo; this.cuerpo = cuerpo; }
    }

    /** POST/PATCH/DELETE a la API REST con el token de la sesión (Prefer opcional). */
    static void escribir(Context c, String metodo, String ruta, String cuerpo, String prefer) throws Exception {
        Respuesta r = peticion(metodo, "/rest/v1/" + ruta, token(c), cuerpo, prefer);
        if (r.codigo >= 300) throw new Exception("Error " + r.codigo + ": " + (r.cuerpo.length() > 120 ? r.cuerpo.substring(0, 120) : r.cuerpo));
    }

    static Respuesta peticion(String metodo, String ruta, String token, String cuerpo) throws Exception {
        return peticion(metodo, ruta, token, cuerpo, null);
    }

    static Respuesta peticion(String metodo, String ruta, String token, String cuerpo, String prefer) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(URL_SB + ruta).openConnection();
        if (prefer != null) con.setRequestProperty("Prefer", prefer);
        con.setRequestMethod(metodo);
        con.setConnectTimeout(8000);
        con.setReadTimeout(8000);
        con.setRequestProperty("apikey", CLAVE);
        con.setRequestProperty("Authorization", "Bearer " + (token != null ? token : CLAVE));
        con.setRequestProperty("Accept", "application/json");
        if (cuerpo != null) {
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/json");
            try (OutputStream o = con.getOutputStream()) { o.write(cuerpo.getBytes(StandardCharsets.UTF_8)); }
        }
        int codigo = con.getResponseCode();
        InputStream in = codigo >= 400 ? con.getErrorStream() : con.getInputStream();
        String texto = "";
        if (in != null) {
            try (InputStream i = in; ByteArrayOutputStream b = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = i.read(buf)) > 0) b.write(buf, 0, n);
                texto = b.toString("UTF-8");
            }
        }
        con.disconnect();
        return new Respuesta(codigo, texto);
    }
}
