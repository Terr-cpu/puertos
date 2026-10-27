package org.asispuerto.admin;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;

/**
 * Las mismas operaciones que hace el planificador, para usarlas desde los widgets
 * y las notificaciones. Aceptar = meterlo en el equipo (le llega el correo de turno
 * confirmado, como siempre); descartar = borrar su apunte.
 */
final class Acciones {
    static final String URL_APUNTARSE = "https://asispuerto.org/sustituciones.html";
    private static final String[] DIAS = {"Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"};

    private Acciones() {}

    /** Semana del mes y día sin tildes, como _evSemanaDia() del planificador. */
    static int semana(String fecha) {
        int d = LocalDate.parse(fecha).getDayOfMonth();
        return d <= 7 ? 1 : d <= 14 ? 2 : d <= 21 ? 3 : d <= 28 ? 4 : 5;
    }

    static String dia(String fecha) {
        return DIAS[LocalDate.parse(fecha).getDayOfWeek().getValue() % 7];
    }

    /** Confirmar en el equipo a un apuntado (accion "confirmarTurno" del planificador). */
    static void aceptar(Context c, String vid, String fecha, String rango) throws Exception {
        JSONObject fila = new JSONObject().put("voluntario_id", vid).put("fecha", fecha)
                .put("semana", semana(fecha)).put("dia", dia(fecha)).put("rango", rango);
        Sesion.escribir(c, "POST", "historial?on_conflict=voluntario_id,fecha,rango",
                new JSONArray().put(fila).toString(), "resolution=merge-duplicates,return=minimal");
        // Correo de "Turno confirmado": ya no sale solo al guardar el turno, se pide aquí (aceptar un apunte)
        try {
            JSONObject aviso = new JSONObject().put("accion", "turno_confirmado").put("fecha", fecha).put("rango", rango)
                    .put("voluntario_ids", new JSONArray().put(vid));
            Sesion.peticion("POST", "/functions/v1/notificar-email", Sesion.token(c), aviso.toString());
        } catch (Exception e) {
            android.util.Log.e("PuertoAdmin", "No se pudo pedir el correo de confirmación", e);
        }
    }

    /** Descartar un apunte (no entra en el turno). */
    static void descartar(Context c, String vid, String fecha, String rango) throws Exception {
        Sesion.escribir(c, "DELETE", "refuerzos?voluntario_id=eq." + enc(vid) + "&fecha=eq." + enc(fecha)
                + "&rango=eq." + enc(rango) + "&es_dia_completo=eq.false", null, "return=minimal");
    }

    /** Texto del aviso para el grupo (el mismo que "📋 Copiar aviso" del planificador). */
    static String aviso(String fecha, String rango, int n) {
        int faltan = Math.max(1, Datos.MIN - n);
        String falta = n == 0 ? "Necesitamos voluntarios" : "Faltan " + faltan + " voluntario" + (faltan == 1 ? "" : "s");
        return "🚨 " + falta + " el " + Datos.diaAviso(fecha) + " de " + rango + ". Si puedes, apúntate aquí: " + URL_APUNTARSE;
    }

    private static String enc(String s) {
        try { return URLEncoder.encode(s, StandardCharsets.UTF_8.name()).replace("+", "%20"); } catch (Exception e) { return s; }
    }
}
