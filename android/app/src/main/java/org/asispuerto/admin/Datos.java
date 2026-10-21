package org.asispuerto.admin;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Lo que enseñan los widgets, con el mismo criterio que el planificador ("En vivo"):
 * van = equipo confirmado − bajas activas + apuntados (baja + apunte = vuelve);
 * los turnos anulados a mano no cuentan; mínimo de 3 voluntarios por turno.
 * Se guarda el último resultado para pintar los widgets sin red.
 */
final class Datos {
    static final int MIN = 3;
    static final int DIAS = 14;   // "Por resolver": próximas dos semanas
    static final ZoneId MADRID = ZoneId.of("Europe/Madrid");

    private Datos() {}

    /** Descarga y calcula; devuelve el resumen en JSON (lo que se guarda en caché). */
    static JSONObject cargar(Context c) throws Exception {
        LocalDate hoy = LocalDate.now(MADRID), fin = hoy.plusDays(DIAS - 1);
        String q = "fecha=gte." + hoy + "&fecha=lte." + fin;
        JSONArray hist = new JSONArray(Sesion.get(c, "v_historial?" + q + "&select=fecha,rango,voluntario_id,tiene_llave"));
        JSONArray bajas = new JSONArray(Sesion.get(c, "v_bajas_activas?" + q + "&select=fecha,rango,voluntario_id"));
        JSONArray refs = new JSONArray(Sesion.get(c, "v_refuerzos?" + q + "&select=fecha,rango,voluntario_id,es_dia_completo,tiene_llave"));
        JSONArray anul = new JSONArray(Sesion.get(c, "turnos_no_realizados?" + q + "&select=fecha,rango"));
        JSONArray cal = new JSONArray(Sesion.get(c, "v_calendario?" + q + "&activo=eq.true&select=fecha,navieras"));
        JSONObject out = calcular(hoy, hist, bajas, refs, anul, cal);
        out.put("ts", System.currentTimeMillis());
        return out;
    }

    /** El cálculo, sin red (se prueba en src/test). */
    static JSONObject calcular(LocalDate hoy, JSONArray hist, JSONArray bajas, JSONArray refs, JSONArray anul, JSONArray cal) throws Exception {

        Map<String, T> turnos = new LinkedHashMap<>();
        Map<String, Boolean> llave = new HashMap<>();
        for (int i = 0; i < hist.length(); i++) {
            JSONObject h = hist.getJSONObject(i);
            T t = turno(turnos, h.getString("fecha"), h.optString("rango"));
            t.equipo.add(h.optString("voluntario_id"));
            llave.put(h.optString("voluntario_id"), h.optBoolean("tiene_llave"));
        }
        for (int i = 0; i < bajas.length(); i++) {
            JSONObject b = bajas.getJSONObject(i);
            if (b.isNull("rango") || b.optString("rango").isEmpty()) continue;
            turno(turnos, b.getString("fecha"), b.getString("rango")).bajas.add(b.optString("voluntario_id"));
        }
        for (int i = 0; i < refs.length(); i++) {
            JSONObject r = refs.getJSONObject(i);
            if (r.optBoolean("es_dia_completo") || r.isNull("rango") || r.optString("rango").isEmpty()) continue;
            turno(turnos, r.getString("fecha"), r.getString("rango")).apuntes.add(r.optString("voluntario_id"));
            llave.put(r.optString("voluntario_id"), r.optBoolean("tiene_llave"));
        }
        Map<String, String> barcos = new HashMap<>();
        for (int i = 0; i < cal.length(); i++) {
            JSONObject d = cal.getJSONObject(i);
            JSONArray navs = d.optJSONArray("navieras");
            List<String> reales = new ArrayList<>();
            if (navs != null) for (int k = 0; k < navs.length(); k++) {
                String n = navs.optString(k);
                if (n.startsWith("turno:")) turno(turnos, d.getString("fecha"), n.substring(6)).abierto = true;
                else if (!n.matches("^(opt:|info:|muelle:).*") && !n.equals("ocultoVol")) reales.add(n);
            }
            if (!reales.isEmpty()) barcos.put(d.getString("fecha"), String.join(" · ", reales));
        }
        Set<String> anulados = new HashSet<>();
        for (int i = 0; i < anul.length(); i++) {
            JSONObject a = anul.getJSONObject(i);
            anulados.add(a.getString("fecha") + "|" + a.optString("rango"));
        }

        // Quién va a cada turno
        for (T t : turnos.values()) {
            Set<String> van = new HashSet<>();
            for (String id : t.equipo) if (!t.bajas.contains(id) || t.apuntes.contains(id)) van.add(id);
            for (String id : t.apuntes) { van.add(id); if (!t.equipo.contains(id)) t.porAceptar++; }
            t.n = van.size();
            boolean alguien = false;
            for (String id : van) if (Boolean.TRUE.equals(llave.get(id))) alguien = true;
            t.sinLlave = t.n > 0 && !alguien;
            for (String id : t.bajas) if (t.equipo.contains(id) && !t.apuntes.contains(id)) t.conBaja = true;
            t.anulado = anulados.contains(t.fecha + "|" + t.rango);
        }
        // Franja habilitada y vacía que se pisa con otra ya cubierta ese día: no pide gente (como el planificador)
        for (T t : turnos.values()) {
            if (t.n > 0 || !t.abierto) continue;
            int[] a = horas(t.rango);
            if (a == null) continue;
            for (T o : turnos.values()) {
                int[] b = horas(o.rango);
                if (o != t && o.fecha.equals(t.fecha) && o.n > 0 && b != null && a[0] < b[1] && b[0] < a[1]) { t.solapa = true; break; }
            }
        }

        int necesitan = 0, porAceptar = 0, bajasSin = 0, sinLlave = 0;
        for (T t : turnos.values()) {
            if (t.anulado || t.solapa) continue;
            if (t.n < MIN) necesitan++;
            porAceptar += t.porAceptar;
            if (t.conBaja && t.n < MIN) bajasSin++;
            if (t.sinLlave) sinLlave++;
        }
        JSONObject out = new JSONObject();
        out.put("hoy", hoy.toString());
        out.put("manana", hoy.plusDays(1).toString());
        out.put("tHoy", lista(turnos, hoy.toString()));
        out.put("tManana", lista(turnos, hoy.plusDays(1).toString()));
        out.put("barcosHoy", barcos.getOrDefault(hoy.toString(), ""));
        out.put("barcosManana", barcos.getOrDefault(hoy.plusDays(1).toString(), ""));
        out.put("necesitan", necesitan);
        out.put("porAceptar", porAceptar);
        out.put("bajasSin", bajasSin);
        out.put("sinLlave", sinLlave);
        return out;
    }

    private static JSONArray lista(Map<String, T> turnos, String fecha) throws Exception {
        List<T> del = new ArrayList<>();
        for (T t : turnos.values()) if (t.fecha.equals(fecha) && !t.solapa) del.add(t);
        del.sort((x, y) -> x.rango.compareTo(y.rango));
        JSONArray a = new JSONArray();
        for (T t : del) a.put(new JSONObject()
                .put("rango", t.rango).put("n", t.n).put("anulado", t.anulado)
                .put("sinLlave", t.sinLlave).put("porAceptar", t.porAceptar));
        return a;
    }

    private static final Pattern HORAS = Pattern.compile("(\\d{1,2}):\\d{2}\\s*a\\s*(\\d{1,2}):\\d{2}");

    private static int[] horas(String r) {
        Matcher m = HORAS.matcher(r == null ? "" : r);
        return m.find() ? new int[]{Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2))} : null;
    }

    private static T turno(Map<String, T> m, String fecha, String rango) {
        String k = fecha + "|" + rango;
        T t = m.get(k);
        if (t == null) { t = new T(fecha, rango); m.put(k, t); }
        return t;
    }

    private static final class T {
        final String fecha, rango;
        final Set<String> equipo = new HashSet<>(), bajas = new HashSet<>(), apuntes = new HashSet<>();
        int n, porAceptar;
        boolean abierto, anulado, sinLlave, conBaja, solapa;
        T(String fecha, String rango) { this.fecha = fecha; this.rango = rango; }
    }

    // ── Caché: último resumen y estado (para pintar sin red) ──
    static void guardar(Context c, JSONObject resumen, String error) {
        c.getSharedPreferences("datos", Context.MODE_PRIVATE).edit()
                .putString("resumen", resumen != null ? resumen.toString() : leerTexto(c))
                .putString("error", error)
                .apply();
    }

    private static String leerTexto(Context c) {
        return c.getSharedPreferences("datos", Context.MODE_PRIVATE).getString("resumen", null);
    }

    static JSONObject leer(Context c) {
        try { String s = leerTexto(c); return s == null ? null : new JSONObject(s); } catch (Exception e) { return null; }
    }

    static String error(Context c) {
        return c.getSharedPreferences("datos", Context.MODE_PRIVATE).getString("error", null);
    }
}
