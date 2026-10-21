package org.asispuerto.admin;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.time.LocalDate;

/** El cálculo de los widgets, con el mismo criterio que "En vivo" del planificador. */
public class DatosTest {
    private static final LocalDate HOY = LocalDate.parse("2026-10-23");

    private static JSONObject f(Object... kv) throws Exception {
        JSONObject o = new JSONObject();
        for (int i = 0; i < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]);
        return o;
    }

    private static JSONArray a(JSONObject... os) {
        JSONArray r = new JSONArray();
        for (JSONObject o : os) r.put(o);
        return r;
    }

    private static JSONObject turno(JSONObject r, String lista, String rango) {
        JSONArray ts = r.optJSONArray(lista);
        for (int i = 0; i < ts.length(); i++) if (ts.optJSONObject(i).optString("rango").equals(rango)) return ts.optJSONObject(i);
        return null;
    }

    @Test
    public void criterioComoElPlanificador() throws Exception {
        String h = "2026-10-23", m = "2026-10-24", luego = "2026-10-28";
        JSONArray hist = a(
                // Hoy 10-12: A (llave), B, C → C de baja → van 2 (faltan)
                f("fecha", h, "rango", "10:00 a 12:00", "voluntario_id", "A", "tiene_llave", true),
                f("fecha", h, "rango", "10:00 a 12:00", "voluntario_id", "B", "tiene_llave", false),
                f("fecha", h, "rango", "10:00 a 12:00", "voluntario_id", "C", "tiene_llave", false),
                // Hoy 16-18: D, E, F sin llave → sale, pero sin llave
                f("fecha", h, "rango", "16:00 a 18:00", "voluntario_id", "D", "tiene_llave", false),
                f("fecha", h, "rango", "16:00 a 18:00", "voluntario_id", "E", "tiene_llave", false),
                f("fecha", h, "rango", "16:00 a 18:00", "voluntario_id", "F", "tiene_llave", false),
                // Mañana 10-12: G con baja y luego se apunta → vuelve; H → van 2
                f("fecha", m, "rango", "10:00 a 12:00", "voluntario_id", "G", "tiene_llave", true),
                f("fecha", m, "rango", "10:00 a 12:00", "voluntario_id", "H", "tiene_llave", false),
                // Día 28: turno anulado a mano (no cuenta)
                f("fecha", luego, "rango", "10:00 a 12:00", "voluntario_id", "A", "tiene_llave", true));
        JSONArray bajas = a(
                f("fecha", h, "rango", "10:00 a 12:00", "voluntario_id", "C"),
                f("fecha", m, "rango", "10:00 a 12:00", "voluntario_id", "G"));
        JSONArray refs = a(
                f("fecha", m, "rango", "10:00 a 12:00", "voluntario_id", "G", "es_dia_completo", false, "tiene_llave", true),
                // Apunte nuevo (no está en el equipo) → por aceptar y cuenta como que va
                f("fecha", m, "rango", "10:00 a 12:00", "voluntario_id", "I", "es_dia_completo", false, "tiene_llave", false),
                // Día completo: no cuenta en ninguna franja
                f("fecha", m, "rango", JSONObject.NULL, "voluntario_id", "J", "es_dia_completo", true, "tiene_llave", false));
        JSONArray anul = a(f("fecha", luego, "rango", "10:00 a 12:00"));
        JSONArray cal = a(
                f("fecha", h, "navieras", new JSONArray().put("Costa Luna").put("turno:10:00 a 12:00").put("muelle:Delicias")),
                // Mañana: franja abierta 16-18 sin nadie → necesita voluntarios
                f("fecha", m, "navieras", new JSONArray().put("turno:16:00 a 18:00")),
                // Día 26: franja abierta vacía que se pisa con... nada → necesita
                f("fecha", "2026-10-26", "navieras", new JSONArray().put("turno:10:00 a 12:00").put("ocultoVol")));

        JSONObject r = Datos.calcular(HOY, hist, bajas, refs, anul, cal);

        JSONObject t1 = turno(r, "tHoy", "10:00 a 12:00");
        assertEquals("baja de C → van 2", 2, t1.getInt("n"));
        assertFalse("A lleva llave", t1.getBoolean("sinLlave"));
        JSONObject t2 = turno(r, "tHoy", "16:00 a 18:00");
        assertEquals(3, t2.getInt("n"));
        assertTrue("nadie con llave", t2.getBoolean("sinLlave"));
        JSONObject t3 = turno(r, "tManana", "10:00 a 12:00");
        assertEquals("G vuelve + H + I apuntado", 3, t3.getInt("n"));
        assertEquals("I por aceptar", 1, t3.getInt("porAceptar"));
        JSONObject t4 = turno(r, "tManana", "16:00 a 18:00");
        assertEquals("franja abierta sin nadie", 0, t4.getInt("n"));

        assertEquals("Costa Luna", r.getString("barcosHoy"));
        // Necesitan: hoy 10-12 (2), mañana 16-18 (0), día 26 abierta (0) → 3 (el 28 está anulado)
        assertEquals(3, r.getInt("necesitan"));
        assertEquals(1, r.getInt("porAceptar"));
        assertEquals("solo hoy 10-12 tiene baja y faltan", 1, r.getInt("bajasSin"));
        assertEquals(1, r.getInt("sinLlave"));
    }

    @Test
    public void franjaVaciaQueSePisaConOtraCubiertaNoPide() throws Exception {
        String h = "2026-10-23";
        JSONArray hist = a(
                f("fecha", h, "rango", "10:00 a 13:00", "voluntario_id", "A", "tiene_llave", true),
                f("fecha", h, "rango", "10:00 a 13:00", "voluntario_id", "B", "tiene_llave", false),
                f("fecha", h, "rango", "10:00 a 13:00", "voluntario_id", "C", "tiene_llave", false));
        JSONArray cal = a(f("fecha", h, "navieras", new JSONArray().put("turno:10:00 a 12:00")));
        JSONObject r = Datos.calcular(HOY, hist, new JSONArray(), new JSONArray(), new JSONArray(), cal);
        assertEquals(0, r.getInt("necesitan"));
        assertEquals("solo se ve el turno cubierto", 1, r.getJSONArray("tHoy").length());
    }
}
