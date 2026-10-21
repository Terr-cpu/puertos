package org.asispuerto.admin;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
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
    static final int DIAS = 14;          // "Por resolver" y la bandeja: próximas dos semanas
    static final int DIAS_SEMANA = 7;    // widget "Próximos 7 días"
    static final int DIAS_PANEL = 30;    // widget "Panel": el próximo mes
    static final ZoneId MADRID = ZoneId.of("Europe/Madrid");
    static final Locale ES = new Locale("es", "ES");

    private Datos() {}

    /** Descarga y calcula; devuelve el resumen en JSON (lo que se guarda en caché). */
    static JSONObject cargar(Context c) throws Exception {
        LocalDate hoy = LocalDate.now(MADRID), fin = hoy.plusDays(DIAS_PANEL - 1);
        String q = "fecha=gte." + hoy + "&fecha=lte." + fin;
        JSONArray hist = new JSONArray(Sesion.get(c, "v_historial?" + q + "&select=fecha,rango,voluntario_id,nombre,tiene_llave"));
        JSONArray bajas = new JSONArray(Sesion.get(c, "v_bajas_activas?" + q + "&select=fecha,rango,voluntario_id"));
        JSONArray refs = new JSONArray(Sesion.get(c, "v_refuerzos?" + q + "&select=fecha,rango,voluntario_id,nombre,es_dia_completo,tiene_llave"));
        JSONArray anul = new JSONArray(Sesion.get(c, "turnos_no_realizados?" + q + "&select=fecha,rango"));
        JSONArray cal = new JSONArray(Sesion.get(c, "v_calendario?" + q + "&activo=eq.true&select=fecha,navieras"));
        JSONObject out = calcular(hoy, hist, bajas, refs, anul, cal);
        JSONArray vols = null, act = null, correos = null;
        try { vols = new JSONArray(Sesion.get(c, "voluntarios?activo=eq.true&select=id,nombre,tiene_llave")); } catch (Exception e) { /* sin ese bloque */ }
        try { act = new JSONArray(Sesion.get(c, "actividad?tipo=in.(baja,apunte)&order=id.desc&limit=6&select=ts,tipo,nombre,fecha,rango,es_dia_completo")); } catch (Exception e) { /* idem */ }
        try {
            String desde = java.time.Instant.now().minusSeconds(24 * 3600).toString();
            correos = new JSONArray(Sesion.get(c, "registro_avisos?ts=gte." + desde + "&select=ok&limit=1000"));
        } catch (Exception e) { /* idem */ }
        out.getJSONObject("panel").put("extra", extras(out.getJSONObject("panel"), vols, act, correos));
        out.put("ts", System.currentTimeMillis());
        return out;
    }

    /** Voluntarios (activos, con llave, sin turnos y los que más tienen), últimos movimientos y correos de las últimas 24 h. */
    static JSONObject extras(JSONObject panel, JSONArray vols, JSONArray act, JSONArray correos) throws Exception {
        JSONObject x = new JSONObject();
        JSONObject carga = panel.optJSONObject("carga");
        if (vols != null) {
            int conLlave = 0, sinTurnos = 0;
            List<JSONObject> lista = new ArrayList<>();
            for (int i = 0; i < vols.length(); i++) {
                JSONObject v = vols.getJSONObject(i);
                if (v.optBoolean("tiene_llave")) conLlave++;
                int n = carga == null ? 0 : carga.optInt(v.optString("id"), 0);
                if (n == 0) sinTurnos++;
                else lista.add(new JSONObject().put("n", corto(v.optString("nombre"))).put("turnos", n));
            }
            lista.sort((a, b) -> b.optInt("turnos") - a.optInt("turnos"));
            JSONArray top = new JSONArray();
            for (int i = 0; i < Math.min(3, lista.size()); i++) top.put(lista.get(i));
            x.put("activos", vols.length()).put("conLlave", conLlave).put("sinTurnos", sinTurnos).put("top", top);
        }
        if (act != null) x.put("actividad", act);
        if (correos != null) {
            int fallos = 0;
            for (int i = 0; i < correos.length(); i++) if (!correos.getJSONObject(i).optBoolean("ok", true)) fallos++;
            x.put("correos", correos.length()).put("correosFallos", fallos);
        }
        return x;
    }

    /** El cálculo, sin red (se prueba en src/test). */
    static JSONObject calcular(LocalDate hoy, JSONArray hist, JSONArray bajas, JSONArray refs, JSONArray anul, JSONArray cal) throws Exception {
        Map<String, T> turnos = new LinkedHashMap<>();
        Map<String, Boolean> llave = new HashMap<>();
        Map<String, String> nombre = new HashMap<>();
        for (int i = 0; i < hist.length(); i++) {
            JSONObject h = hist.getJSONObject(i);
            String id = h.optString("voluntario_id");
            turno(turnos, h.getString("fecha"), h.optString("rango")).equipo.add(id);
            llave.put(id, h.optBoolean("tiene_llave"));
            if (!h.isNull("nombre")) nombre.put(id, h.optString("nombre"));
        }
        for (int i = 0; i < bajas.length(); i++) {
            JSONObject b = bajas.getJSONObject(i);
            if (b.isNull("rango") || b.optString("rango").isEmpty()) continue;
            turno(turnos, b.getString("fecha"), b.getString("rango")).bajas.add(b.optString("voluntario_id"));
        }
        for (int i = 0; i < refs.length(); i++) {
            JSONObject r = refs.getJSONObject(i);
            String id = r.optString("voluntario_id");
            if (!r.isNull("nombre")) nombre.put(id, r.optString("nombre"));
            llave.put(id, r.optBoolean("tiene_llave"));
            if (r.optBoolean("es_dia_completo") || r.isNull("rango") || r.optString("rango").isEmpty()) continue;
            turno(turnos, r.getString("fecha"), r.getString("rango")).apuntes.add(id);
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

        // Quién va a cada turno (en orden: confirmados, los que vuelven y los apuntados)
        for (T t : turnos.values()) {
            for (String id : t.equipo) if (!t.bajas.contains(id) || t.apuntes.contains(id)) t.van.add(id);
            for (String id : t.apuntes) { t.van.add(id); if (!t.equipo.contains(id)) t.pendientes.add(id); }
            t.n = t.van.size();
            boolean alguien = false;
            for (String id : t.van) if (Boolean.TRUE.equals(llave.get(id))) alguien = true;
            t.sinLlave = t.n > 0 && !alguien;
            for (String id : t.bajas) if (t.equipo.contains(id) && !t.apuntes.contains(id)) t.deBaja.add(id);
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

        List<T> orden = new ArrayList<>(turnos.values());
        orden.sort((x, y) -> (x.fecha + x.rango).compareTo(y.fecha + y.rango));

        int necesitan = 0, porAceptar = 0, bajasSin = 0, sinLlave = 0;
        JSONArray bandeja = new JSONArray();
        String lim = hoy.plusDays(DIAS - 1).toString();
        for (T t : orden) {
            if (t.anulado || t.solapa || t.fecha.compareTo(lim) > 0) continue;
            int faltan = Math.max(0, MIN - t.n);
            if (faltan > 0) necesitan++;
            porAceptar += t.pendientes.size();
            if (!t.deBaja.isEmpty() && faltan > 0) bajasSin++;
            if (t.sinLlave) sinLlave++;
            // Bandeja: lo que pide una acción, de lo más urgente (antes) a lo más lejano
            JSONObject base = new JSONObject().put("fecha", t.fecha).put("rango", t.rango).put("n", t.n).put("faltan", faltan);
            for (String id : t.pendientes) bandeja.put(new JSONObject(base.toString())
                    .put("tipo", "apunte").put("vid", id).put("nombre", corto(nombre.get(id))).put("nombreCompleto", nombre.getOrDefault(id, "")));
            if (faltan > 0 && !t.deBaja.isEmpty()) {
                List<String> quien = new ArrayList<>();
                for (String id : t.deBaja) quien.add(corto(nombre.get(id)));
                bandeja.put(new JSONObject(base.toString()).put("tipo", "baja").put("nombre", String.join(", ", quien)));
            } else if (faltan > 0) {
                bandeja.put(new JSONObject(base.toString()).put("tipo", "faltan"));
            }
            if (t.sinLlave) bandeja.put(new JSONObject(base.toString()).put("tipo", "llave"));
        }

        // Próximos 7 días: cada turno con quién va
        JSONArray semana = new JSONArray();
        for (int d = 0; d < DIAS_SEMANA; d++) {
            String f = hoy.plusDays(d).toString();
            JSONArray ts = new JSONArray();
            for (T t : orden) {
                if (!t.fecha.equals(f) || t.solapa) continue;
                JSONArray van = new JSONArray();
                for (String id : t.van) van.put(new JSONObject().put("n", corto(nombre.get(id)))
                        .put("llave", Boolean.TRUE.equals(llave.get(id))).put("pendiente", t.pendientes.contains(id)));
                ts.put(new JSONObject().put("rango", t.rango).put("n", t.n).put("anulado", t.anulado)
                        .put("sinLlave", t.sinLlave).put("porAceptar", t.pendientes.size()).put("van", van));
            }
            if (ts.length() > 0 || barcos.containsKey(f))
                semana.put(new JSONObject().put("fecha", f).put("barcos", barcos.getOrDefault(f, "")).put("turnos", ts));
        }

        JSONObject panel = new JSONObject();
        int total = 0, cubiertos = 0, faltanT = 0, sinNadie = 0, llaveT = 0;
        int[] semT = new int[4], semC = new int[4];
        Map<String, Integer> carga = new HashMap<>();
        Map<String, int[]> porDia = new HashMap<>();   // fecha → {turnos, cubiertos, peor (0 ok,1 faltan,2 nadie)}
        for (T t : orden) {
            if (t.anulado || t.solapa) continue;
            total++;
            int dias = (int) java.time.temporal.ChronoUnit.DAYS.between(hoy, LocalDate.parse(t.fecha));
            int s = Math.min(3, Math.max(0, dias / 7));
            semT[s]++;
            if (t.n >= MIN) { cubiertos++; semC[s]++; } else if (t.n == 0) sinNadie++; else faltanT++;
            if (t.sinLlave) llaveT++;
            for (String id : t.van) carga.merge(id, 1, Integer::sum);
            int[] d = porDia.computeIfAbsent(t.fecha, k -> new int[3]);
            d[0]++;
            if (t.n >= MIN) d[1]++;
            d[2] = Math.max(d[2], t.n == 0 ? 2 : t.n < MIN ? 1 : 0);
        }
        panel.put("total", total).put("cubiertos", cubiertos).put("faltan", faltanT).put("sinNadie", sinNadie).put("sinLlave", llaveT);
        JSONArray semanas = new JSONArray();
        for (int s = 0; s < 4; s++) {
            LocalDate ini = hoy.plusDays(s * 7L), finS = s == 3 ? hoy.plusDays(DIAS_PANEL - 1) : ini.plusDays(6);
            semanas.put(new JSONObject().put("ini", ini.toString()).put("fin", finS.toString()).put("total", semT[s]).put("cubiertos", semC[s]));
        }
        panel.put("semanas", semanas);
        List<String> diasBarco = new ArrayList<>(barcos.keySet());
        diasBarco.sort(String::compareTo);
        JSONArray proxBarcos = new JSONArray();
        for (String f : diasBarco) {
            if (proxBarcos.length() >= 5) break;
            int[] d = porDia.getOrDefault(f, new int[3]);
            proxBarcos.put(new JSONObject().put("fecha", f).put("barcos", barcos.get(f))
                    .put("turnos", d[0]).put("cubiertos", d[1]).put("peor", d[0] == 0 ? -1 : d[2]));
        }
        panel.put("barcos", proxBarcos);
        JSONObject cargaJ = new JSONObject();
        for (Map.Entry<String, Integer> e : carga.entrySet()) cargaJ.put(e.getKey(), e.getValue());
        panel.put("carga", cargaJ);

        JSONObject out = new JSONObject();
        out.put("panel", panel);
        out.put("hoy", hoy.toString());
        out.put("manana", hoy.plusDays(1).toString());
        out.put("tHoy", lista(orden, hoy.toString()));
        out.put("tManana", lista(orden, hoy.plusDays(1).toString()));
        out.put("barcosHoy", barcos.getOrDefault(hoy.toString(), ""));
        out.put("barcosManana", barcos.getOrDefault(hoy.plusDays(1).toString(), ""));
        out.put("necesitan", necesitan);
        out.put("porAceptar", porAceptar);
        out.put("bajasSin", bajasSin);
        out.put("sinLlave", sinLlave);
        out.put("semana", semana);
        out.put("bandeja", bandeja);
        return out;
    }

    private static JSONArray lista(List<T> orden, String fecha) throws Exception {
        JSONArray a = new JSONArray();
        for (T t : orden) if (t.fecha.equals(fecha) && !t.solapa) a.put(new JSONObject()
                .put("rango", t.rango).put("n", t.n).put("anulado", t.anulado)
                .put("sinLlave", t.sinLlave).put("porAceptar", t.pendientes.size()));
        return a;
    }

    /** "PEDRO RUIZ GARCIA" → "Pedro R." (nombre de pila e inicial, para que quepa en el widget). */
    static String corto(String n) {
        if (n == null || n.trim().isEmpty()) return "(voluntario)";
        String[] p = n.trim().toLowerCase(ES).split("\\s+");
        String s = p[0].substring(0, 1).toUpperCase(ES) + p[0].substring(1);
        return p.length > 1 ? s + " " + p[1].substring(0, 1).toUpperCase(ES) + "." : s;
    }

    /** "2026-10-23" → "Vie 23 oct". */
    static String diaCorto(String iso) {
        try {
            String s = LocalDate.parse(iso).format(DateTimeFormatter.ofPattern("EEE d MMM", ES)).replace(".", "");
            return s.substring(0, 1).toUpperCase(ES) + s.substring(1);
        } catch (Exception e) { return iso; }
    }

    /** "2026-10-23" → "viernes 23/10" (para los mensajes de WhatsApp, como el planificador). */
    static String diaAviso(String iso) {
        try {
            return LocalDate.parse(iso).format(DateTimeFormatter.ofPattern("EEEE d/MM", ES));
        } catch (Exception e) { return iso; }
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
        final Set<String> equipo = new LinkedHashSet<>(), bajas = new HashSet<>(), apuntes = new LinkedHashSet<>();
        final Set<String> van = new LinkedHashSet<>(), pendientes = new LinkedHashSet<>(), deBaja = new LinkedHashSet<>();
        int n;
        boolean abierto, anulado, sinLlave, solapa;
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
