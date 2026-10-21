package org.asispuerto.admin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;

/**
 * Comprobación en segundo plano (cada ~15 min, la frecuencia mínima de Android):
 * actualiza los widgets y avisa con una notificación de lo nuevo:
 * alguien se apunta o se da de baja, o un correo a un voluntario no se pudo enviar.
 * Lee la tabla "actividad" (la rellenan los triggers de la base de datos) y "registro_avisos".
 */
public class Avisos extends JobService {
    private static final int TRABAJO = 1, AHORA = 2;

    /** Actualización de los widgets cuanto antes (al pulsar ↻, al abrir la app, tras una acción). */
    static void actualizarYa(Context c) {
        try {
            android.os.PersistableBundle extra = new android.os.PersistableBundle();
            extra.putBoolean("soloWidgets", true);
            ((JobScheduler) c.getSystemService(JOB_SCHEDULER_SERVICE)).schedule(
                    new JobInfo.Builder(AHORA, new ComponentName(c, Avisos.class))
                            .setOverrideDeadline(0)
                            .setExtras(extra)
                            .build());
        } catch (RuntimeException e) {
            new Thread(() -> Widgets.refrescarAhora(c)).start();   // por si el sistema no la admite
        }
    }
    static final String CANAL_CAMBIOS = "cambios", CANAL_CORREOS = "correos";

    /** Programa la comprobación periódica (al abrir la app y al reiniciar el móvil). */
    static void programar(Context c) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(JOB_SCHEDULER_SERVICE);
            if (js.getPendingJob(TRABAJO) != null) return;
            js.schedule(new JobInfo.Builder(TRABAJO, new ComponentName(c, Avisos.class))
                    .setPeriodic(15 * 60 * 1000L)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPersisted(true)
                    .build());
        } catch (RuntimeException e) {
            // Si el sistema no deja programarla, la app sigue funcionando (sin notificaciones)
            android.util.Log.e("PuertoAdmin", "No se pudo programar la comprobación", e);
        }
    }

    static void crearCanales(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CANAL_CAMBIOS, "Bajas y apuntes", NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(new NotificationChannel(CANAL_CORREOS, "Correos que fallan", NotificationManager.IMPORTANCE_DEFAULT));
    }

    @Override
    public boolean onStartJob(JobParameters p) {
        Context c = getApplicationContext();
        new Thread(() -> {
            try {
                Widgets.refrescarAhora(c);
                if (Sesion.conectada(c) && !p.getExtras().getBoolean("soloWidgets", false)) comprobar(c);
            } catch (Exception ignorado) {
                // Sin red o sesión caducada: se reintenta en la próxima vuelta
            } finally {
                jobFinished(p, false);
            }
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters p) { return true; }

    /** Busca novedades desde la última vez y las notifica. La primera vez solo toma nota. */
    static void comprobar(Context c) throws Exception {
        crearCanales(c);
        SharedPreferences pr = c.getSharedPreferences("avisos", MODE_PRIVATE);
        long ultAct = pr.getLong("actividad", -1), ultCorreo = pr.getLong("correo", -1);
        if (ultAct < 0 || ultCorreo < 0) {
            pr.edit().putLong("actividad", maxId(c, "actividad")).putLong("correo", maxId(c, "registro_avisos")).apply();
            return;
        }
        String hoy = LocalDate.now(Datos.MADRID).toString();
        JSONObject resumen = Datos.leer(c);

        JSONArray act = new JSONArray(Sesion.get(c, "actividad?id=gt." + ultAct
                + "&tipo=in.(baja,apunte)&select=id,tipo,nombre,voluntario_id,fecha,rango,es_dia_completo&order=id.asc&limit=40"));
        long nuevoAct = ultAct;
        int mostradas = 0;
        for (int i = 0; i < act.length(); i++) {
            JSONObject e = act.getJSONObject(i);
            nuevoAct = Math.max(nuevoAct, e.getLong("id"));
            String fecha = e.optString("fecha");
            if (fecha.compareTo(hoy) < 0) continue;              // turnos ya pasados: no interesa
            if (mostradas++ >= 6) continue;                       // no inundar si hay muchos de golpe
            if ("apunte".equals(e.optString("tipo"))) notificarApunte(c, e, resumen);
            else notificarBaja(c, e, resumen);
        }
        if (mostradas > 6) notificar(c, 999, CANAL_CAMBIOS, "Hay " + mostradas + " cambios nuevos", "Ábrelos en Bajas y apuntes",
                abrir(c, "cambios", null, null, 999), null);

        JSONArray correos = new JSONArray(Sesion.get(c, "registro_avisos?id=gt." + ultCorreo
                + "&select=id,ok,tipo,nombre,destino,detalle&order=id.asc&limit=100"));
        long nuevoCorreo = ultCorreo;
        int fallos = 0;
        String ejemplo = "";
        for (int i = 0; i < correos.length(); i++) {
            JSONObject e = correos.getJSONObject(i);
            nuevoCorreo = Math.max(nuevoCorreo, e.getLong("id"));
            if (!e.optBoolean("ok", true)) {
                fallos++;
                ejemplo = (e.isNull("nombre") ? e.optString("destino") : e.optString("nombre")) + (e.isNull("detalle") ? "" : ": " + e.optString("detalle"));
            }
        }
        if (fallos > 0) notificar(c, 900, CANAL_CORREOS,
                "⚠ " + (fallos == 1 ? "Un correo no se pudo enviar" : fallos + " correos no se pudieron enviar"),
                ejemplo, abrir(c, "inicio", null, null, 900), null);

        pr.edit().putLong("actividad", nuevoAct).putLong("correo", nuevoCorreo).apply();
    }

    private static long maxId(Context c, String tabla) throws Exception {
        JSONArray a = new JSONArray(Sesion.get(c, tabla + "?select=id&order=id.desc&limit=1"));
        return a.length() > 0 ? a.getJSONObject(0).getLong("id") : 0;
    }

    /** Busca en la bandeja calculada lo que se sabe de un turno (para decir si falta gente). */
    private static JSONObject enBandeja(JSONObject resumen, String tipo, String fecha, String rango, String vid) {
        JSONArray b = resumen == null ? null : resumen.optJSONArray("bandeja");
        if (b == null) return null;
        for (int i = 0; i < b.length(); i++) {
            JSONObject x = b.optJSONObject(i);
            if (x.optString("fecha").equals(fecha) && x.optString("rango").equals(rango) && x.optString("tipo").equals(tipo)
                    && (vid == null || vid.equals(x.optString("vid")))) return x;
        }
        return null;
    }

    private static void notificarApunte(Context c, JSONObject e, JSONObject resumen) {
        String nombre = Datos.corto(e.optString("nombre")), fecha = e.optString("fecha"), rango = e.optString("rango");
        int id = (int) e.optLong("id");
        if (e.optBoolean("es_dia_completo") || e.isNull("rango") || rango.isEmpty()) {
            notificar(c, id, CANAL_CAMBIOS, "📅 " + nombre + " se ofrece todo el día", Datos.diaCorto(fecha),
                    abrir(c, "cambios", null, null, id), null);
            return;
        }
        // Si ya no está pendiente (lo aceptaste tú al añadirlo como sustituto), no hace falta avisar
        JSONObject p = enBandeja(resumen, "apunte", fecha, rango, e.optString("voluntario_id"));
        if (resumen != null && p == null) return;
        int n = p != null ? p.optInt("n") : 0;
        Notification.Action[] acc = {
                accion(c, "✓ Aceptar", new Intent().putExtra("accion", "aceptar").putExtra("vid", e.optString("voluntario_id"))
                        .putExtra("nombre", e.optString("nombre")).putExtra("fecha", fecha).putExtra("rango", rango).putExtra("notif", id), id * 10 + 1),
                accion(c, "✕ Descartar", new Intent().putExtra("accion", "descartar").putExtra("vid", e.optString("voluntario_id"))
                        .putExtra("nombre", e.optString("nombre")).putExtra("fecha", fecha).putExtra("rango", rango).putExtra("notif", id), id * 10 + 2)};
        notificar(c, id, CANAL_CAMBIOS, "✋ " + nombre + " se ha apuntado",
                Datos.diaCorto(fecha) + " · " + rango + (p != null ? " · van " + n + "/" + Datos.MIN : ""),
                abrir(c, "cambios", fecha, rango, id), acc);
    }

    private static void notificarBaja(Context c, JSONObject e, JSONObject resumen) {
        String nombre = Datos.corto(e.optString("nombre")), fecha = e.optString("fecha"), rango = e.optString("rango");
        int id = (int) e.optLong("id");
        JSONObject t = enBandeja(resumen, "baja", fecha, rango, null);
        if (t == null) t = enBandeja(resumen, "faltan", fecha, rango, null);
        String estado = t == null ? "el turno sigue cubierto" : (t.optInt("faltan") == 1 ? "falta 1 voluntario" : "faltan " + t.optInt("faltan") + " voluntarios");
        Notification.Action[] acc = t == null ? null : new Notification.Action[]{
                accion(c, "📋 Aviso al grupo", new Intent().putExtra("accion", "aviso").putExtra("fecha", fecha)
                        .putExtra("rango", rango).putExtra("n", t.optInt("n")).putExtra("notif", id), id * 10 + 1),
                accion(c, "👥 Sustituto", new Intent().putExtra("accion", "abrir").putExtra("tab", "cambios")
                        .putExtra("fecha", fecha).putExtra("rango", rango).putExtra("notif", id), id * 10 + 2)};
        notificar(c, id, CANAL_CAMBIOS, "✕ " + nombre + " se ha dado de baja",
                Datos.diaCorto(fecha) + " · " + rango + " · " + estado, abrir(c, "cambios", fecha, rango, id), acc);
    }

    private static PendingIntent abrir(Context c, String tab, String fecha, String rango, int codigo) {
        Intent i = new Intent(c, AccionActivity.class).putExtra("accion", "abrir").putExtra("tab", tab).putExtra("notif", codigo)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (fecha != null) i.putExtra("fecha", fecha).putExtra("rango", rango);
        return PendingIntent.getActivity(c, codigo * 10, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static Notification.Action accion(Context c, String texto, Intent extras, int codigo) {
        Intent i = new Intent(c, AccionActivity.class).putExtras(extras).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(c, codigo, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(null, texto, pi).build();
    }

    private static void notificar(Context c, int id, String canal, String titulo, String texto, PendingIntent alTocar, Notification.Action[] acciones) {
        Notification.Builder b = new Notification.Builder(c, canal)
                .setSmallIcon(R.drawable.ic_notif)
                .setColor(0xFF0A1628)
                .setContentTitle(titulo)
                .setContentText(texto)
                .setStyle(new Notification.BigTextStyle().bigText(texto))
                .setContentIntent(alTocar)
                .setAutoCancel(true);
        if (acciones != null) for (Notification.Action a : acciones) b.addAction(a);
        try {
            ((NotificationManager) c.getSystemService(NOTIFICATION_SERVICE)).notify(id, b.build());
        } catch (SecurityException sinPermiso) { /* el usuario no ha dado permiso de notificaciones */ }
    }
}
