package org.asispuerto.admin;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * El planificador de asispuerto.org dentro de la app (la misma web, siempre al día).
 * Los enlaces de fuera (WhatsApp, correo, calendario, formularios) se abren en su app.
 */
public class MainActivity extends Activity {
    static final String INICIO = "https://asispuerto.org/planificador.html";
    private static final String DOMINIO = "asispuerto.org";
    private static final int ELEGIR_ARCHIVO = 7;

    private WebView web;
    private ValueCallback<Uri[]> archivoCallback;
    private String tabPendiente, turnoPendiente;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Window w = getWindow();
        w.setStatusBarColor(0xFF0A1628);
        w.setNavigationBarColor(0xFF0A1628);

        web = new WebView(this);
        web.setBackgroundColor(0xFFEEF1F6);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " PuertoAdminApp/1.0");

        web.addJavascriptInterface(new Puente(), "AppPuerto");
        web.setWebViewClient(new Cliente());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, ua, cd, tipo, largo) -> {
            if (url.startsWith("http")) abrirFuera(url);
            else Toast.makeText(this, "Las descargas se hacen desde el navegador", Toast.LENGTH_LONG).show();
        });

        tabPendiente = getIntent().getStringExtra("tab");
        turnoPendiente = getIntent().getStringExtra("k");

        // Notificaciones de bajas y apuntes: canales, permiso (Android 13+) y comprobación periódica
        Avisos.crearCanales(this);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1);
        }
        if (Sesion.conectada(this)) Avisos.programar(this);
        if (b != null) web.restoreState(b);
        else web.loadUrl(INICIO);
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        String tab = i.getStringExtra("tab");
        if (tab != null) { tabPendiente = tab; turnoPendiente = i.getStringExtra("k"); irATab(); }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Al volver a la app, refrescar los widgets (lo que se haya cambiado se ve enseguida)
        if (Widgets.hayWidgets(this)) Widgets.actualizar(this, null);
    }

    @Override
    protected void onSaveInstanceState(Bundle b) {
        super.onSaveInstanceState(b);
        web.saveState(b);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /** Abrir la pestaña pedida por un widget cuando el planificador esté listo (tras el login). */
    private void irATab() {
        if (tabPendiente == null) return;
        String tab = tabPendiente.replaceAll("[^a-z]", "");
        // Turno concreto (fecha|rango): en "Hoy" se resalta con evFoco; en las demás pestañas basta la pestaña
        String k = turnoPendiente == null ? "" : turnoPendiente.replaceAll("[^0-9:| a-]", "");
        tabPendiente = null;
        turnoPendiente = null;
        String foco = k.isEmpty() || !"envivo".equals(tab) ? "" : "setTimeout(function(){try{evFoco('" + k + "')}catch(e){}},700);";
        web.evaluateJavascript("(function ir(n){if(window.setTab&&window.EV&&EV.data){setTab('" + tab + "');" + foco + "}"
                + "else if(n<80){setTimeout(function(){ir(n+1)},250)}})(0)", null);
    }

    private void abrirFuera(String url) {
        try {
            Intent i = url.startsWith("intent:") ? Intent.parseUri(url, Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No hay ninguna app para abrir este enlace", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo abrir el enlace", Toast.LENGTH_SHORT).show();
        }
    }

    private class Cliente extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            String host = u.getHost() == null ? "" : u.getHost();
            boolean nuestra = ("https".equals(u.getScheme()) || "http".equals(u.getScheme()))
                    && (host.equals(DOMINIO) || host.endsWith("." + DOMINIO) || host.endsWith(".supabase.co"));
            if (nuestra) return false;
            abrirFuera(u.toString());
            return true;
        }

        @Override
        public void onPageStarted(WebView v, String url, Bitmap icono) {
            super.onPageStarted(v, url, icono);
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            // window.print() no hace nada en un WebView: se pasa a la impresión de Android (PDF)
            v.evaluateJavascript("window.print=function(){AppPuerto.imprimir()};", null);
            if (url.contains("planificador.html")) irATab();
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (archivoCallback != null) archivoCallback.onReceiveValue(null);
            archivoCallback = cb;
            try {
                startActivityForResult(p.createIntent(), ELEGIR_ARCHIVO);
            } catch (ActivityNotFoundException e) {
                archivoCallback = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int codigo, int resultado, Intent datos) {
        if (codigo == ELEGIR_ARCHIVO && archivoCallback != null) {
            archivoCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultado, datos));
            archivoCallback = null;
            return;
        }
        super.onActivityResult(codigo, resultado, datos);
    }

    /** Lo que la web puede pedir a la app. */
    private class Puente {
        @JavascriptInterface
        public void imprimir() {
            runOnUiThread(() -> {
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                pm.print("Cuadrante Puerto de Sevilla", web.createPrintDocumentAdapter("Cuadrante"),
                        new PrintAttributes.Builder().build());
            });
        }

        @JavascriptInterface
        public void conectarWidgets() {
            runOnUiThread(() -> startActivity(new Intent(MainActivity.this, ConectarActivity.class)));
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.setVisibility(View.GONE); web.destroy(); }
        super.onDestroy();
    }
}
