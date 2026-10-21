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
                f("fecha", h, "rango", "10:00 a 12:00", "voluntario_id", "C", "nombre", "CARLOS PEREZ", "tiene_llave", false),
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

        // Bandeja: por fecha; apunte de I (con su id para aceptar), baja de C, franjas sin gente y sin llave
        JSONArray b = r.getJSONArray("bandeja");
        String tipos = "";
        for (int i = 0; i < b.length(); i++) tipos += b.getJSONObject(i).getString("tipo") + "@" + b.getJSONObject(i).getString("fecha").substring(8) + " ";
        assertEquals("baja@23 llave@23 apunte@24 faltan@24 faltan@26 ", tipos);
        JSONObject ap = b.getJSONObject(2);
        assertEquals("I", ap.getString("vid"));
        assertEquals("Carlos P.", b.getJSONObject(0).getString("nombre"));
        assertEquals(1, b.getJSONObject(0).getInt("faltan"));

        // Semana: el día 24 con G (vuelve, llave) y H; I aparece como pendiente
        JSONArray sem = r.getJSONArray("semana");
        JSONObject d24 = sem.getJSONObject(1);
        assertEquals(m, d24.getString("fecha"));
        JSONArray van = d24.getJSONArray("turnos").getJSONObject(0).getJSONArray("van");
        assertEquals(3, van.length());
        assertTrue(van.getJSONObject(0).getBoolean("llave"));
        assertTrue(van.getJSONObject(2).getBoolean("pendiente"));
    }

    @Test
    public void panelDelMes() throws Exception {
        // Hoy (23) cubierto; día 30 (2.ª semana) con 1; día 10/11 (3.ª semana) sin nadie; día 25 fuera de las 2 semanas pero dentro del mes
        JSONArray hist = a(
                f("fecha", "2026-10-23", "rango", "10:00 a 12:00", "voluntario_id", "A", "nombre", "ANA LOPEZ", "tiene_llave", true),
                f("fecha", "2026-10-23", "rango", "10:00 a 12:00", "voluntario_id", "B", "nombre", "BEA RUIZ", "tiene_llave", false),
                f("fecha", "2026-10-23", "rango", "10:00 a 12:00", "voluntario_id", "C", "nombre", "CARLOS PEREZ", "tiene_llave", false),
                f("fecha", "2026-10-30", "rango", "10:00 a 12:00", "voluntario_id", "A", "nombre", "ANA LOPEZ", "tiene_llave", true),
                f("fecha", "2026-11-20", "rango", "10:00 a 12:00", "voluntario_id", "B", "nombre", "BEA RUIZ", "tiene_llave", false));
        JSONArray cal = a(
                f("fecha", "2026-10-23", "navieras", new JSONArray().put("Costa Luna")),
                f("fecha", "2026-11-11", "navieras", new JSONArray().put("AIDA Nova").put("turno:10:00 a 12:00")));
        JSONObject r = Datos.calcular(HOY, hist, new JSONArray(), new JSONArray(), new JSONArray(), cal);
        JSONObject p = r.getJSONObject("panel");
        assertEquals(4, p.getInt("total"));
        assertEquals(1, p.getInt("cubiertos"));
        assertEquals(1, p.getInt("sinNadie"));
        assertEquals(2, p.getInt("faltan"));
        assertEquals("semana 1 y 2: 1 turno cada una", "1/1 0/1 0/1 0/1 ", semanas(p));
        JSONArray b = p.getJSONArray("barcos");
        assertEquals("Costa Luna", b.getJSONObject(0).getString("barcos"));
        assertEquals(0, b.getJSONObject(0).getInt("peor"));
        assertEquals(2, b.getJSONObject(1).getInt("peor"));
        // Fuera de las 2 semanas no cuenta para "Por resolver"
        assertEquals("día 30 dentro; 11 y 20 de noviembre fuera", 1, r.getInt("necesitan"));
        // Extras: voluntarios
        JSONArray vols = a(f("id", "A", "nombre", "ANA LOPEZ", "tiene_llave", true), f("id", "B", "nombre", "BEA RUIZ", "tiene_llave", false),
                f("id", "C", "nombre", "CARLOS PEREZ", "tiene_llave", false), f("id", "D", "nombre", "DANI GIL", "tiene_llave", false));
        JSONObject x = Datos.extras(p, vols, null, a(f("ok", true), f("ok", false)));
        assertEquals(4, x.getInt("activos"));
        assertEquals(1, x.getInt("conLlave"));
        assertEquals("Dani no tiene turnos", 1, x.getInt("sinTurnos"));
        assertEquals("Ana L.", x.getJSONArray("top").getJSONObject(0).getString("n"));
        assertEquals(1, x.getInt("correosFallos"));
    }

    private static String semanas(JSONObject p) {
        JSONArray s = p.optJSONArray("semanas");
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) b.append(s.optJSONObject(i).optInt("cubiertos")).append("/").append(s.optJSONObject(i).optInt("total")).append(" ");
        return b.toString();
    }

    @Test
    public void nombresCortos() {
        assertEquals("Pedro R.", Datos.corto("PEDRO RUIZ GARCIA"));
        assertEquals("Ana", Datos.corto("ANA"));
        assertEquals("(voluntario)", Datos.corto(null));
    }

    @Test
    public void semanaYDiaComoElPlanificador() {
        assertEquals(4, Acciones.semana("2026-10-23"));
        assertEquals(5, Acciones.semana("2026-10-29"));
        assertEquals("Viernes", Acciones.dia("2026-10-23"));
        assertEquals("Miercoles", Acciones.dia("2026-10-21"));
        assertEquals("Domingo", Acciones.dia("2026-10-25"));
        assertTrue(Acciones.aviso("2026-10-23", "10:00 a 12:00", 2).startsWith("🚨 Faltan 1 voluntario el viernes 23/10 de 10:00 a 12:00"));
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
