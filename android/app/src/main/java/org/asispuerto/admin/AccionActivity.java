package org.asispuerto.admin;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

/**
 * Lo que se pulsa en un widget o en una notificación: abrir la app en su sitio,
 * compartir el aviso por WhatsApp, o aceptar/descartar un apunte (siempre con confirmación).
 * Pantalla transparente: solo se ve el diálogo.
 */
public class AccionActivity extends Activity {

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Intent i = getIntent();
        String accion = i.getStringExtra("accion");
        String fecha = i.getStringExtra("fecha"), rango = i.getStringExtra("rango");
        String vid = i.getStringExtra("vid"), nombre = i.getStringExtra("nombre");
        int n = i.getIntExtra("n", 0);
        int notif = i.getIntExtra("notif", 0);
        if (notif != 0) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(notif);
        if (accion == null) { finish(); return; }

        switch (accion) {
            case "aviso": {
                Intent compartir = new Intent(Intent.ACTION_SEND).setType("text/plain")
                        .putExtra(Intent.EXTRA_TEXT, Acciones.aviso(fecha, rango, n));
                startActivity(Intent.createChooser(compartir, "Enviar el aviso"));
                finish();
                break;
            }
            case "aceptar":
                confirmar("¿Aceptar a " + nombre + "?",
                        Datos.diaCorto(fecha) + " · " + rango + "\n\nEntra en el equipo y le llega el correo de turno confirmado.",
                        "✓ Aceptar", () -> Acciones.aceptar(this, vid, fecha, rango), nombre + " confirmado ✓");
                break;
            case "descartar":
                confirmar("¿Descartar el apunte de " + nombre + "?",
                        Datos.diaCorto(fecha) + " · " + rango + "\n\nNo entrará en el turno.",
                        "Descartar", () -> Acciones.descartar(this, vid, fecha, rango), "Apunte descartado");
                break;
            default: {   // "abrir": la app en la pestaña (y el turno) indicados
                Intent abrir = new Intent(this, MainActivity.class)
                        .putExtra("tab", i.getStringExtra("tab") != null ? i.getStringExtra("tab") : "envivo")
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                if (fecha != null && rango != null) abrir.putExtra("k", fecha + "|" + rango);
                startActivity(abrir);
                finish();
            }
        }
    }

    interface Operacion { void hacer() throws Exception; }

    private void confirmar(String titulo, String texto, String boton, Operacion op, String hecho) {
        new AlertDialog.Builder(this, android.R.style.Theme_Material_Light_Dialog_Alert)
                .setTitle(titulo)
                .setMessage(texto)
                .setPositiveButton(boton, (d, w) -> new Thread(() -> {
                    String error = null;
                    try { op.hacer(); } catch (Sesion.SinSesion e) { error = "Conecta primero los widgets (toca uno de ellos)"; }
                    catch (Exception e) { error = e.getMessage(); }
                    String err = error;
                    runOnUiThread(() -> {
                        Toast.makeText(getApplicationContext(), err == null ? hecho : "⚠ No se pudo: " + err, Toast.LENGTH_LONG).show();
                        finish();
                    });
                    Widgets.actualizar(getApplicationContext(), null);
                }).start())
                .setNegativeButton("Cancelar", (d, w) -> finish())
                .setOnCancelListener(d -> finish())
                .show();
    }
}
