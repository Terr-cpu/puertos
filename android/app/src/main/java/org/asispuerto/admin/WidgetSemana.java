package org.asispuerto.admin;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;

/** Widget "Próximos 7 días": cada turno con quién va, la llave y los barcos. */
public class WidgetSemana extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        Widgets.pintarTodos(c, false);
        Widgets.actualizar(c, goAsync());
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
