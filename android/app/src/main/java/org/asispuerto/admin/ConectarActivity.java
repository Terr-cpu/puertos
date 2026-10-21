package org.asispuerto.admin;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

/**
 * Conectar los widgets con la cuenta de administrador (una sola vez).
 * Los widgets usan su propia sesión, aparte de la de la web.
 */
public class ConectarActivity extends Activity {
    private EditText email, clave;
    private Button entrar, desconectar;
    private TextView estado;
    private View formulario;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(0xFF0A1628);
        setContentView(R.layout.activity_conectar);
        email = findViewById(R.id.email);
        clave = findViewById(R.id.clave);
        entrar = findViewById(R.id.entrar);
        desconectar = findViewById(R.id.desconectar);
        estado = findViewById(R.id.estado);
        formulario = findViewById(R.id.formulario);
        entrar.setOnClickListener(v -> conectar());
        desconectar.setOnClickListener(v -> {
            Sesion.cerrar(this);
            Datos.guardar(this, null, "sin_sesion");
            Widgets.pintarTodos(this, false);
            pintar(null);
        });
        findViewById(R.id.cerrar).setOnClickListener(v -> finish());
        pintar(null);
    }

    private void pintar(String mensaje) {
        boolean ok = Sesion.conectada(this);
        formulario.setVisibility(ok ? View.GONE : View.VISIBLE);
        desconectar.setVisibility(ok ? View.VISIBLE : View.GONE);
        estado.setText(mensaje != null ? mensaje
                : ok ? "✓ Widgets conectados con " + Sesion.email(this) + ".\nYa puedes volver a la pantalla de inicio."
                : "Escribe el correo y la contraseña de administrador (los mismos del planificador). Solo hace falta una vez.");
    }

    private void conectar() {
        String e = email.getText().toString().trim(), k = clave.getText().toString();
        if (e.isEmpty() || k.isEmpty()) { pintar("Escribe el correo y la contraseña."); return; }
        entrar.setEnabled(false);
        entrar.setText("Conectando…");
        new Thread(() -> {
            String error = null;
            try { Sesion.iniciar(this, e, k); } catch (Exception ex) { error = ex.getMessage(); }
            String err = error;
            runOnUiThread(() -> {
                entrar.setEnabled(true);
                entrar.setText("Conectar");
                if (err == null) {
                    clave.setText("");
                    pintar(null);
                    Widgets.pintarTodos(this, true);
                    Widgets.actualizar(this, null);
                } else pintar("⚠ " + err);
            });
        }).start();
    }
}
