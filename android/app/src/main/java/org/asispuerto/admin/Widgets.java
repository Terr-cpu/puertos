package org.asispuerto.admin;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Date;
import java.util.Locale;

/** Actualización y pintado de los dos widgets (comparten datos y botón de actualizar). */
final class Widgets {
    static final String ACCION_ACTUALIZAR = "org.asispuerto.admin.ACTUALIZAR";
    private static final Locale ES = new Locale("es", "ES");

    private Widgets() {}

    /** Descarga en segundo plano, guarda y repinta todos los widgets. `fin` (opcional) al terminar. */
    static void actualizar(Context ctx, BroadcastReceiver.PendingResult fin) {
        Context c = ctx.getApplicationContext();
        new Thread(() -> {
            try {
                if (!Sesion.conectada(c)) {
                    Datos.guardar(c, null, "sin_sesion");
                } else {
                    Datos.guardar(c, Datos.cargar(c), null);
                }
            } catch (Sesion.SinSesion e) {
                Datos.guardar(c, null, "sin_sesion");
            } catch (Exception e) {
                Datos.guardar(c, null, e.getMessage() != null ? e.getMessage() : "Sin conexión");
            } finally {
                pintarTodos(c, false);
                if (fin != null) fin.finish();
            }
        }).start();
    }

    /** ¿Hay algún widget en la pantalla de inicio? (para no descargar en vano al abrir la app) */
    static boolean hayWidgets(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        for (Class<?> k : TODOS) if (m.getAppWidgetIds(new ComponentName(c, k)).length > 0) return true;
        return false;
    }

    static final Class<?>[] TODOS = {WidgetTurnos.class, WidgetResolver.class, WidgetSemana.class, WidgetBandeja.class};

    static void pintarTodos(Context c, boolean actualizando) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        for (int id : m.getAppWidgetIds(new ComponentName(c, WidgetTurnos.class))) m.updateAppWidget(id, vistaTurnos(c, actualizando));
        for (int id : m.getAppWidgetIds(new ComponentName(c, WidgetResolver.class))) m.updateAppWidget(id, vistaResolver(c, actualizando));
        int[] sem = m.getAppWidgetIds(new ComponentName(c, WidgetSemana.class));
        for (int id : sem) m.updateAppWidget(id, vistaLista(c, id, ListaService.SEMANA, actualizando));
        int[] ban = m.getAppWidgetIds(new ComponentName(c, WidgetBandeja.class));
        for (int id : ban) m.updateAppWidget(id, vistaLista(c, id, ListaService.BANDEJA, actualizando));
        if (sem.length > 0) m.notifyAppWidgetViewDataChanged(sem, R.id.lista);
        if (ban.length > 0) m.notifyAppWidgetViewDataChanged(ban, R.id.lista);
    }

    // ── Widgets con lista desplazable ("Próximos 7 días" y "Bandeja") ──
    static RemoteViews vistaLista(Context c, int idWidget, String tipo, boolean actualizando) {
        boolean semana = ListaService.SEMANA.equals(tipo);
        Class<?> clase = semana ? WidgetSemana.class : WidgetBandeja.class;
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_lista);
        JSONObject r = Datos.leer(c);
        boolean sinSesion = !Sesion.conectada(c);
        v.setTextViewText(R.id.titulo, semana ? "📅  Próximos 7 días" : "⚡  Bandeja · 2 semanas");
        v.setViewVisibility(R.id.conectar, sinSesion ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.lista, sinSesion ? View.GONE : View.VISIBLE);
        v.setOnClickPendingIntent(R.id.conectar, conectar(c));
        v.setOnClickPendingIntent(R.id.actualizar, refrescar(c, clase));
        v.setOnClickPendingIntent(R.id.titulo, abrir(c, semana ? "envivo" : "cambios", semana ? 30 : 40));
        v.setTextViewText(R.id.pie, sinSesion ? "" : pie(c, r, actualizando));
        v.setTextViewText(R.id.vacio, semana ? "Sin turnos en los próximos 7 días" : "🎉 Nada pendiente en las próximas dos semanas");
        Intent servicio = new Intent(c, ListaService.class).putExtra("tipo", tipo)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, idWidget);
        servicio.setData(Uri.parse(servicio.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.lista, servicio);
        v.setEmptyView(R.id.lista, R.id.vacio);
        // Plantilla para las pulsaciones de cada fila / botón (se completa en ListaService)
        Intent plantilla = new Intent(c, AccionActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        v.setPendingIntentTemplate(R.id.lista, PendingIntent.getActivity(c, semana ? 31 : 41, plantilla,
                PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        return v;
    }

    // ── Pulsaciones ──
    /** Abre la app en una pestaña del planificador. */
    static PendingIntent abrir(Context c, String tab, int codigo) {
        Intent i = new Intent(c, MainActivity.class).putExtra("tab", tab).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, codigo, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static PendingIntent conectar(Context c) {
        Intent i = new Intent(c, ConectarActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, 90, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static PendingIntent refrescar(Context c, Class<?> clase) {
        Intent i = new Intent(c, clase).setAction(ACCION_ACTUALIZAR);
        int codigo = clase == WidgetTurnos.class ? 1 : clase == WidgetResolver.class ? 2 : clase == WidgetSemana.class ? 3 : 4;
        return PendingIntent.getBroadcast(c, codigo, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // ── Textos comunes ──
    private static String pie(Context c, JSONObject r, boolean actualizando) {
        if (actualizando) return "Actualizando…";
        String err = Datos.error(c);
        String hora = r != null ? new SimpleDateFormat("HH:mm", ES).format(new Date(r.optLong("ts"))) : "";
        if (err != null && !"sin_sesion".equals(err)) return "⚠ Sin conexión" + (hora.isEmpty() ? "" : " · datos de las " + hora);
        return hora.isEmpty() ? "" : "Actualizado a las " + hora;
    }

    private static String dia(String iso) {
        try {
            String s = LocalDate.parse(iso).format(DateTimeFormatter.ofPattern("EEE d MMM", ES)).replace(".", "");
            return s.substring(0, 1).toUpperCase(ES) + s.substring(1);
        } catch (Exception e) { return iso; }
    }

    /** Una línea de turno: "🟢 10:00 a 12:00 · 3/3 · ✋1 · sin llave". */
    private static String linea(JSONObject t) {
        int n = t.optInt("n");
        String punto = t.optBoolean("anulado") ? "⚫" : n == 0 ? "🔴" : n < Datos.MIN ? "🟠" : "🟢";
        StringBuilder s = new StringBuilder(punto).append("  ").append(t.optString("rango"));
        if (t.optBoolean("anulado")) return s.append("  · anulado").toString();
        s.append("   ").append(n).append("/").append(Datos.MIN);
        if (t.optInt("porAceptar") > 0) s.append(" · ✋").append(t.optInt("porAceptar"));
        if (t.optBoolean("sinLlave")) s.append(" · sin llave");
        return s.toString();
    }

    private static final int[] FILAS_HOY = {R.id.hoy1, R.id.hoy2, R.id.hoy3, R.id.hoy4};
    private static final int[] FILAS_MAN = {R.id.man1, R.id.man2, R.id.man3, R.id.man4};

    private static void filas(RemoteViews v, int[] ids, int vacio, JSONArray ts) {
        int n = ts == null ? 0 : ts.length();
        v.setViewVisibility(vacio, n == 0 ? View.VISIBLE : View.GONE);
        for (int i = 0; i < ids.length; i++) {
            if (i < n && (i < ids.length - 1 || n == ids.length)) {
                v.setTextViewText(ids[i], linea(ts.optJSONObject(i)));
                v.setViewVisibility(ids[i], View.VISIBLE);
            } else if (i == ids.length - 1 && n > ids.length) {
                v.setTextViewText(ids[i], "+ " + (n - ids.length + 1) + " turnos más");
                v.setViewVisibility(ids[i], View.VISIBLE);
            } else {
                v.setViewVisibility(ids[i], View.GONE);
            }
        }
    }

    // ── Widget "Hoy y mañana" ──
    static RemoteViews vistaTurnos(Context c, boolean actualizando) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_turnos);
        JSONObject r = Datos.leer(c);
        boolean sinSesion = !Sesion.conectada(c);
        v.setViewVisibility(R.id.conectar, sinSesion ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.contenido, sinSesion ? View.GONE : View.VISIBLE);
        v.setOnClickPendingIntent(R.id.conectar, conectar(c));
        v.setOnClickPendingIntent(R.id.actualizar, refrescar(c, WidgetTurnos.class));
        v.setOnClickPendingIntent(R.id.titulo, abrir(c, "inicio", 10));
        v.setOnClickPendingIntent(R.id.bloque_hoy, abrir(c, "envivo", 11));
        v.setOnClickPendingIntent(R.id.bloque_man, abrir(c, "envivo", 12));
        v.setTextViewText(R.id.pie, sinSesion ? "" : pie(c, r, actualizando));
        if (r != null && !sinSesion) {
            String bh = r.optString("barcosHoy"), bm = r.optString("barcosManana");
            v.setTextViewText(R.id.cab_hoy, "HOY · " + dia(r.optString("hoy")) + (bh.isEmpty() ? "" : "  🚢 " + bh));
            v.setTextViewText(R.id.cab_man, "MAÑANA · " + dia(r.optString("manana")) + (bm.isEmpty() ? "" : "  🚢 " + bm));
            filas(v, FILAS_HOY, R.id.hoy_vacio, r.optJSONArray("tHoy"));
            filas(v, FILAS_MAN, R.id.man_vacio, r.optJSONArray("tManana"));
        }
        return v;
    }

    // ── Widget "Por resolver" ──
    static RemoteViews vistaResolver(Context c, boolean actualizando) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_resolver);
        JSONObject r = Datos.leer(c);
        boolean sinSesion = !Sesion.conectada(c);
        v.setViewVisibility(R.id.conectar, sinSesion ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.contenido, sinSesion ? View.GONE : View.VISIBLE);
        v.setOnClickPendingIntent(R.id.conectar, conectar(c));
        v.setOnClickPendingIntent(R.id.actualizar, refrescar(c, WidgetResolver.class));
        v.setOnClickPendingIntent(R.id.titulo, abrir(c, "cambios", 20));
        v.setOnClickPendingIntent(R.id.k_necesitan, abrir(c, "cambios", 21));
        v.setOnClickPendingIntent(R.id.k_aceptar, abrir(c, "cambios", 22));
        v.setOnClickPendingIntent(R.id.k_bajas, abrir(c, "cambios", 23));
        v.setOnClickPendingIntent(R.id.k_llave, abrir(c, "mes", 24));
        v.setTextViewText(R.id.pie, sinSesion ? "" : pie(c, r, actualizando));
        if (r != null && !sinSesion) {
            v.setTextViewText(R.id.n_necesitan, String.valueOf(r.optInt("necesitan")));
            v.setTextViewText(R.id.n_aceptar, String.valueOf(r.optInt("porAceptar")));
            v.setTextViewText(R.id.n_bajas, String.valueOf(r.optInt("bajasSin")));
            v.setTextViewText(R.id.n_llave, String.valueOf(r.optInt("sinLlave")));
            v.setTextColor(R.id.n_necesitan, r.optInt("necesitan") > 0 ? 0xFFFF6B5E : 0xFF5BE39A);
            v.setTextColor(R.id.n_bajas, r.optInt("bajasSin") > 0 ? 0xFFFFB347 : 0xFF5BE39A);
            v.setTextColor(R.id.n_llave, r.optInt("sinLlave") > 0 ? 0xFFFFB347 : 0xFF5BE39A);
            v.setTextColor(R.id.n_aceptar, r.optInt("porAceptar") > 0 ? 0xFF6FB5FF : 0xFF5BE39A);
        }
        return v;
    }
}
