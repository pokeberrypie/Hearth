package com.hearth.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps Hearth answering while your computer is using it.
 *
 * Desk mode opens a door on the Wi-Fi so the computer can use the library on
 * this phone. The server behind that door is the embedded Node runtime, which
 * lives in this app's ":engine" process — and Android freezes a process that
 * has nothing on screen, then turns the Wi-Fi radio down once the screen is
 * off. Either one leaves the computer waiting on a reply that never comes.
 *
 * A foreground service is the sanctioned way to say "this is still doing
 * something for the person": it carries a notification for as long as it
 * runs, which is also the honest thing to show while the phone is answering
 * the network. It holds a partial wake lock for the processor and a Wi-Fi
 * lock for the radio, and lets both go the moment desk mode is switched off.
 *
 * Declared in the ":engine" process in the manifest, because that is the
 * process it exists to keep alive.
 */
public class ServingService extends Service {
  private static final String CHANNEL = "serving";
  private static final int NOTICE = 1;

  private PowerManager.WakeLock wake;
  private WifiManager.WifiLock wifi;

  static void start(Context context) {
    Intent i = new Intent(context, ServingService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i);
    else context.startService(i);
  }

  static void stop(Context context) {
    context.stopService(new Intent(context, ServingService.class));
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
      NotificationChannel ch = new NotificationChannel(
          CHANNEL, "Serving your computer", NotificationManager.IMPORTANCE_LOW);
      ch.setDescription("Shown while your computer can use the library on this phone.");
      nm.createNotificationChannel(ch);
    }

    // Tapping it brings Hearth back to the front, where the switch is.
    Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
    PendingIntent tap = open == null ? null : PendingIntent.getActivity(
        this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

    Notification n = new Notification.Builder(this, CHANNEL)
        .setSmallIcon(android.R.drawable.stat_sys_upload)
        .setContentTitle("Hearth is serving your computer")
        .setContentText("Turn it off under Connection when you are done.")
        .setOngoing(true)
        .setContentIntent(tap)
        .build();

    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTICE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
    } else {
      startForeground(NOTICE, n);
    }

    if (wake == null) {
      PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
      wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "hearth:serving");
      wake.setReferenceCounted(false);
      wake.acquire();
    }
    if (wifi == null) {
      WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
      if (wm != null) {
        @SuppressWarnings("deprecation")
        int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
        wifi = wm.createWifiLock(mode, "hearth:serving");
        wifi.setReferenceCounted(false);
        wifi.acquire();
      }
    }
    // Not sticky: if Android does kill it, desk mode is off, and the switch
    // should say so rather than a service quietly coming back on its own.
    return START_NOT_STICKY;
  }

  @Override
  public void onDestroy() {
    if (wake != null && wake.isHeld()) wake.release();
    if (wifi != null && wifi.isHeld()) wifi.release();
    wake = null;
    wifi = null;
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
