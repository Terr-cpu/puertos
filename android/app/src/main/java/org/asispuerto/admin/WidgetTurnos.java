package org.asispuerto.admin;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;

/** Widget "Hoy y mañana": los turnos de los dos días con su estado. */
public class WidgetTurnos extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        Widgets.pintarTodos(c, false);          // lo guardado, al instante
        Widgets.actualizar(c, goAsync());       // y luego lo nuevo
    }

    @Override
    public void onReceive(Context c, Intent i) {
        if (Widgets.ACCION_ACTUALIZAR.equals(i.getAction())) {
            Widgets.pintarTodos(c, true);
            Widgets.actualizar(c, goAsync());
            return;
        }
        super.onReceive(c, i);
    }
}
