package org.asispuerto.admin;

import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Filas desplazables de los widgets "Próximos 7 días" y "Bandeja". */
public class ListaService extends RemoteViewsService {
    static final String SEMANA = "semana", BANDEJA = "bandeja", PANEL = "panel";

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Fabrica(getApplicationContext(), intent.getStringExtra("tipo"));
    }

    private static final class Fabrica implements RemoteViewsFactory {
        private final Context c;
        private final String tipo;
        private final List<JSONObject> filas = new ArrayList<>();

        Fabrica(Context c, String tipo) { this.c = c; this.tipo = tipo; }

        @Override public void onCreate() {}
        @Override public void onDestroy() {}
        @Override public int getViewTypeCount() { return 4; }
        @Override public long getItemId(int p) { return p; }
        @Override public boolean hasStableIds() { return false; }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getCount() { return filas.size(); }

        @Override
        public void onDataSetChanged() {
            filas.clear();
            JSONObject r = Sesion.conectada(c) ? Datos.leer(c) : null;
            if (r == null) return;
            try {
                if (SEMANA.equals(tipo)) {
                    JSONArray dias = r.optJSONArray("semana");
                    if (dias == null) return;
                    for (int i = 0; i < dias.length(); i++) {
                        JSONObject d = dias.getJSONObject(i);
                        filas.add(new JSONObject().put("fila", "dia").put("fecha", d.getString("fecha")).put("barcos", d.optString("barcos"))
                                .put("preparando", d.optBoolean("preparando")));
                        JSONArray ts = d.optJSONArray("turnos");
                        if (ts == null || ts.length() == 0) filas.add(new JSONObject().put("fila", "nada"));
                        else for (int k = 0; k < ts.length(); k++) filas.add(ts.getJSONObject(k).put("fila", "turno").put("fecha", d.getString("fecha")));
                    }
                } else if (PANEL.equals(tipo)) {
                    filasPanel(r);
                } else {
                    JSONArray b = r.optJSONArray("bandeja");
                    if (b != null) for (int i = 0; i < b.length(); i++) filas.add(b.getJSONObject(i));
                }
            } catch (Exception ignorado) { /* caché antigua: se rehará al actualizar */ }
        }

        @Override
        public RemoteViews getViewAt(int p) {
            if (p >= filas.size()) return null;
            JSONObject f = filas.get(p);
            return SEMANA.equals(tipo) ? filaSemana(f) : PANEL.equals(tipo) ? filaPanel(f) : filaBandeja(f);
        }

        // ── Panel: el próximo mes y el estado general ──
        private void sec(String t) throws Exception { filas.add(new JSONObject().put("fila", "sec").put("t", t)); }

        private void dato(String l1, String l2, String tab) throws Exception {
            filas.add(new JSONObject().put("fila", "dato").put("l1", l1).put("l2", l2 == null ? "" : l2).put("tab", tab));
        }

        private static String hace(String ts) {
            try {
                long min = java.time.Duration.between(java.time.OffsetDateTime.parse(ts).toInstant(), java.time.Instant.now()).toMinutes();
                if (min < 1) return "ahora";
                if (min < 60) return "hace " + min + " min";
                if (min < 48 * 60) return "hace " + (min / 60) + " h";
                return "hace " + (min / 1440) + " días";
            } catch (Exception e) { return ""; }
        }

        private void filasPanel(JSONObject r) throws Exception {
            JSONObject p = r.optJSONObject("panel");
            if (p == null) return;
            int total = p.optInt("total"), cub = p.optInt("cubiertos");
            sec("PRÓXIMOS 30 DÍAS · DÍAS VISIBLES");
            dato("📊  " + total + " turnos · " + cub + " cubiertos" + (total > 0 ? " (" + Math.round(100f * cub / total) + " %)" : ""),
                    "🔴 " + p.optInt("sinNadie") + " sin nadie · 🟠 " + p.optInt("faltan") + " con faltas · 🔑 " + p.optInt("sinLlave") + " sin llave", "mes");
            int prep = p.optInt("diasPreparando");
            if (prep > 0) {
                int vacios = p.optInt("sinNadiePrep");
                dato("🛠  " + prep + (prep == 1 ? " día en preparación" : " días en preparación"),
                        "Ocultos a los voluntarios" + (vacios > 0 ? " · " + vacios + " turno" + (vacios == 1 ? "" : "s") + " aún sin nadie" : ""), "calendario");
            }
            JSONArray sem = p.optJSONArray("semanas");
            String[] nombres = {"Esta semana", "La próxima", "Dentro de 2 semanas", "Dentro de 3 semanas"};
            if (sem != null) for (int i = 0; i < sem.length(); i++) {
                JSONObject s = sem.getJSONObject(i);
                int t = s.optInt("total"), c = s.optInt("cubiertos");
                filas.add(new JSONObject().put("fila", "semana").put("l1", nombres[i]).put("cifra", t == 0 ? "sin turnos" : c + "/" + t)
                        .put("pct", t == 0 ? 0 : Math.round(100f * c / t))
                        .put("l2", Datos.diaCorto(s.optString("ini")) + " – " + Datos.diaCorto(s.optString("fin"))).put("tab", "mes"));
            }
            JSONArray bs = p.optJSONArray("barcos");
            if (bs != null && bs.length() > 0) {
                sec("PRÓXIMOS BARCOS");
                for (int i = 0; i < bs.length(); i++) {
                    JSONObject b = bs.getJSONObject(i);
                    int peor = b.optInt("peor"), t = b.optInt("turnos");
                    String estado = peor < 0 ? "sin turnos todavía" : (peor == 0 ? "🟢 " : peor == 1 ? "🟠 " : "🔴 ")
                            + b.optInt("cubiertos") + " de " + t + " turno" + (t == 1 ? "" : "s") + " cubierto" + (t == 1 ? "" : "s");
                    dato("🚢  " + b.optString("barcos"), Datos.diaCorto(b.optString("fecha")) + "  ·  " + estado
                            + (b.optBoolean("preparando") ? "  ·  🛠 en preparación" : ""), "mes");
                }
            }
            JSONObject x = p.optJSONObject("extra");
            if (x != null && x.has("activos")) {
                sec("VOLUNTARIOS");
                dato("👥  " + x.optInt("activos") + " activos · 🔑 " + x.optInt("conLlave") + " con llave",
                        x.optInt("sinTurnos") + " sin ningún turno en los próximos 30 días", "voluntarios");
                JSONArray top = x.optJSONArray("top");
                if (top != null && top.length() > 0) {
                    StringBuilder t = new StringBuilder();
                    for (int i = 0; i < top.length(); i++) {
                        if (t.length() > 0) t.append("  ·  ");
                        t.append(top.getJSONObject(i).optString("n")).append(" ").append(top.getJSONObject(i).optInt("turnos"));
                    }
                    dato("Más turnos este mes", t.toString(), "estadisticas");
                }
            }
            JSONArray act = x == null ? null : x.optJSONArray("actividad");
            if (act != null && act.length() > 0) {
                sec("ÚLTIMOS MOVIMIENTOS");
                for (int i = 0; i < act.length(); i++) {
                    JSONObject e = act.getJSONObject(i);
                    boolean baja = "baja".equals(e.optString("tipo"));
                    boolean diaEntero = e.optBoolean("es_dia_completo") || e.isNull("rango");
                    dato((baja ? "✕  " : "✋  ") + Datos.corto(e.optString("nombre")) + (baja ? " se dio de baja" : diaEntero ? " se ofrece todo el día" : " se apuntó")
                                    + "  ·  " + hace(e.optString("ts")),
                            Datos.diaCorto(e.optString("fecha")) + (diaEntero ? "" : " · " + e.optString("rango")), "cambios");
                }
            }
            if (x != null && x.has("correos")) {
                sec("CORREOS · ÚLTIMAS 24 H");
                int n = x.optInt("correos"), mal = x.optInt("correosFallos");
                dato("📧  " + n + " enviado" + (n == 1 ? "" : "s") + (mal == 0 ? (n > 0 ? " · ✓ todos bien" : "") : " · ⚠ " + mal + " fallaron"),
                        mal > 0 ? "Míralos en Inicio → Avisos enviados" : null, "inicio");
            }
        }

        private RemoteViews filaPanel(JSONObject f) {
            if ("semana".equals(f.optString("fila"))) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.item_semana);
                v.setTextViewText(R.id.linea1, f.optString("l1"));
                v.setTextViewText(R.id.cifra, f.optString("cifra"));
                v.setProgressBar(R.id.barra, 100, f.optInt("pct"), false);
                v.setTextViewText(R.id.linea2, f.optString("l2"));
                v.setOnClickFillInIntent(R.id.fila, new Intent().putExtra("accion", "abrir").putExtra("tab", f.optString("tab")));
                return v;
            }
            if ("sec".equals(f.optString("fila"))) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.item_dia);
                v.setTextViewText(R.id.texto, f.optString("t"));
                return v;
            }
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.item_turno);
            v.setTextViewText(R.id.linea1, f.optString("l1"));
            v.setTextViewText(R.id.linea2, f.optString("l2"));
            v.setViewVisibility(R.id.linea2, f.optString("l2").isEmpty() ? View.GONE : View.VISIBLE);
            v.setOnClickFillInIntent(R.id.fila, new Intent().putExtra("accion", "abrir").putExtra("tab", f.optString("tab")));
            return v;
        }

        // ── Próximos 7 días ──
        private RemoteViews filaSemana(JSONObject f) {
            String clase = f.optString("fila");
            if ("dia".equals(clase)) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.item_dia);
                String b = f.optString("barcos");
                v.setTextViewText(R.id.texto, Datos.diaCorto(f.optString("fecha")).toUpperCase(Datos.ES)
                        + (f.optBoolean("preparando") ? "  · 🛠 EN PREPARACIÓN" : "") + (b.isEmpty() ? "" : "   🚢 " + b));
                return v;
            }
            if ("nada".equals(clase)) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.item_dia);
                v.setTextViewText(R.id.texto, "Sin turnos");
                v.setTextColor(R.id.texto, 0xFFA9B4C7);
                return v;
            }
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.item_turno);
            int n = f.optInt("n");
            boolean anulado = f.optBoolean("anulado");
            String punto = anulado ? "⚫" : n == 0 ? "🔴" : n < Datos.MIN ? "🟠" : "🟢";
            String l1 = punto + "  " + f.optString("rango") + (anulado ? "   anulado" : "   " + n + "/" + Datos.MIN)
                    + (f.optBoolean("sinLlave") && !anulado ? "  · sin llave" : "");
            StringBuilder l2 = new StringBuilder();
            JSONArray van = f.optJSONArray("van");
            if (van != null) for (int i = 0; i < van.length(); i++) {
                JSONObject x = van.optJSONObject(i);
                if (l2.length() > 0) l2.append(" · ");
                l2.append(x.optBoolean("pendiente") ? "✋" : "").append(x.optString("n")).append(x.optBoolean("llave") ? " 🔑" : "");
            }
            v.setTextViewText(R.id.linea1, l1);
            v.setTextViewText(R.id.linea2, l2.length() > 0 ? l2.toString() : "Nadie todavía");
            v.setOnClickFillInIntent(R.id.fila, new Intent().putExtra("accion", "abrir").putExtra("tab", "envivo")
                    .putExtra("fecha", f.optString("fecha")).putExtra("rango", f.optString("rango")));
            return v;
        }

        // ── Bandeja ──
        private RemoteViews filaBandeja(JSONObject f) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.item_bandeja);
            String fecha = f.optString("fecha"), rango = f.optString("rango"), nombre = f.optString("nombre");
            int n = f.optInt("n"), faltan = f.optInt("faltan");
            String cuando = Datos.diaCorto(fecha) + " · " + rango + (f.optBoolean("preparando") ? " · 🛠" : "");
            String titulo, detalle;
            Intent b1 = null, b2 = null;
            String t1 = null, t2 = null;
            switch (f.optString("tipo")) {
                case "apunte":
                    titulo = "✋  " + nombre + " se ha apuntado";
                    detalle = cuando + "  ·  van " + n + "/" + Datos.MIN;
                    t1 = "✓ Aceptar"; b1 = accion("aceptar", f).putExtra("vid", f.optString("vid")).putExtra("nombre", f.optString("nombreCompleto", nombre));
                    t2 = "✕ Descartar"; b2 = accion("descartar", f).putExtra("vid", f.optString("vid")).putExtra("nombre", f.optString("nombreCompleto", nombre));
                    break;
                case "baja":
                    titulo = "✕  Baja de " + nombre;
                    detalle = cuando + "  ·  " + (faltan == 1 ? "falta 1" : "faltan " + faltan);
                    t1 = "👥 Sustituto"; b1 = accion("abrir", f).putExtra("tab", "cambios");
                    t2 = "📋 Aviso"; b2 = accion("aviso", f);
                    break;
                case "llave":
                    titulo = "🔑  Nadie lleva llave";
                    detalle = cuando + "  ·  van " + n;
                    t1 = "Ver turno"; b1 = accion("abrir", f).putExtra("tab", "cambios");
                    break;
                default:   // faltan voluntarios (sin bajas)
                    titulo = (n == 0 ? "🔴  Sin nadie" : "🟠  " + (faltan == 1 ? "Falta 1 voluntario" : "Faltan " + faltan + " voluntarios"));
                    detalle = cuando + (n > 0 ? "  ·  van " + n : "");
                    t1 = "📋 Aviso"; b1 = accion("aviso", f);
                    t2 = "👥 Sustituto"; b2 = accion("abrir", f).putExtra("tab", "cambios");
            }
            v.setTextViewText(R.id.titulo, titulo);
            v.setTextViewText(R.id.detalle, detalle);
            boton(v, R.id.b1, t1, b1);
            boton(v, R.id.b2, t2, b2);
            v.setOnClickFillInIntent(R.id.fila, accion("abrir", f).putExtra("tab", "cambios"));
            return v;
        }

        private static Intent accion(String a, JSONObject f) {
            return new Intent().putExtra("accion", a).putExtra("fecha", f.optString("fecha"))
                    .putExtra("rango", f.optString("rango")).putExtra("n", f.optInt("n"));
        }

        private static void boton(RemoteViews v, int id, String texto, Intent i) {
            if (texto == null) { v.setViewVisibility(id, View.GONE); return; }
            v.setViewVisibility(id, View.VISIBLE);
            v.setTextViewText(id, texto);
            v.setOnClickFillInIntent(id, i);
        }
    }
}
