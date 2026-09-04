package com.hearth.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * A deliberately boring, native-free launcher. MainActivity owns Node and the
 * WebView in the `:engine` process; if that process aborts before Java gets an
 * exception, this activity survives and has somewhere to report the failure.
 *
 * The report itself comes from Diagnostics — files in getFilesDir() written by
 * MainActivity, by HearthApplication's crash handler, and by main.js inside
 * the embedded Node runtime. That last one is the point: a JavaScript startup
 * error used to exist only in logcat.
 */
public class BootstrapActivity extends Activity {
  private static final int ENGINE_REQUEST = 41;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // A failure left over from the previous launch is shown before the engine
    // is given another chance to die the same way.
    if (Diagnostics.hasFailure(this)) {
      showFailure();
      return;
    }
    showStarting();
    startEngine();
  }

  private void startEngine() {
    startActivityForResult(new Intent(this, MainActivity.class), ENGINE_REQUEST);
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode != ENGINE_REQUEST) return;
    if (resultCode == RESULT_OK) {
      // MainActivity exited on purpose (the user backed out of a working app).
      finish();
      return;
    }
    showFailure();
  }

  private void showStarting() {
    LinearLayout root = root();
    root.addView(heading("Starting Hearth…"));
    root.addView(body("Starting the local server. This may take a few seconds the first time."));
    setContentView(root);
  }

  private void showFailure() {
    String details = Diagnostics.report(this);

    LinearLayout root = root();
    root.addView(heading("This crashed. Here's the error code:"));

    TextView detail = body(details);
    detail.setTextIsSelectable(true);
    ScrollView scroller = new ScrollView(this);
    scroller.addView(detail);
    root.addView(scroller, new LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

    Button copy = new Button(this);
    copy.setText("Copy error");
    copy.setOnClickListener(v -> {
      ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
      if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("Hearth error", details));
      Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show();
    });
    root.addView(copy);

    Button retry = new Button(this);
    retry.setText("Try again");
    retry.setOnClickListener(v -> {
      Diagnostics.clear(this,
          Diagnostics.STAGE, Diagnostics.NODE_ERROR, Diagnostics.JAVA_CRASH);
      showStarting();
      startEngine();
    });
    root.addView(retry);

    setContentView(root);
  }

  private LinearLayout root() {
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setGravity(Gravity.CENTER_VERTICAL);
    root.setBackgroundColor(Color.parseColor("#16110e"));
    int pad = dp(20);
    root.setPadding(pad, pad, pad, pad);
    return root;
  }

  private TextView heading(String text) {
    TextView view = new TextView(this);
    view.setText(text);
    view.setTextColor(Color.parseColor("#d8a25f"));
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
    return view;
  }

  private TextView body(String text) {
    TextView view = new TextView(this);
    view.setText(text);
    view.setTextColor(Color.parseColor("#e8ddc8"));
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
    view.setPadding(0, dp(16), 0, dp(16));
    return view;
  }

  private int dp(int value) {
    return (int) TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }
}
