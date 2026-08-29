package com.personal.os

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.max
import kotlin.math.roundToInt

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Edge-to-edge + SDK 35+: adjustResize alone will not shrink WebView.
    // We pad the WebView by IME height so HTML layout sits above the keyboard.
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)

    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }

    val root = findViewById<ViewGroup>(android.R.id.content)
    // CSS vars only here — do not pad content (would double with WebView padding).
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      applyInsetsToCss(findWebView(v), insets)
      insets
    }
    ViewCompat.requestApplyInsets(root)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)

    ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
      applyImePadding(v, insets)
      applyInsetsToCss(webView, insets)
      insets
    }

    ViewCompat.setWindowInsetsAnimationCallback(
      webView,
      object : WindowInsetsAnimationCompat.Callback(
        WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE,
      ) {
        override fun onProgress(
          insets: WindowInsetsCompat,
          runningAnimations: MutableList<WindowInsetsAnimationCompat>,
        ): WindowInsetsCompat {
          applyImePadding(webView, insets)
          applyInsetsToCss(webView, insets)
          return insets
        }
      },
    )

    ViewCompat.requestApplyInsets(webView)
  }

  /** Shrink WebView above the soft keyboard (required on Android 15+ edge-to-edge). */
  private fun applyImePadding(target: View, insets: WindowInsetsCompat) {
    val imeBottom = max(insets.getInsets(WindowInsetsCompat.Type.ime()).bottom, 0)
    if (target.paddingBottom != imeBottom) {
      target.setPadding(
        target.paddingLeft,
        target.paddingTop,
        target.paddingRight,
        imeBottom,
      )
    }
  }

  private fun applyInsetsToCss(webView: WebView?, insets: WindowInsetsCompat) {
    if (webView == null) return
    val bars = insets.getInsets(
      WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    )
    val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
    val density = resources.displayMetrics.density.coerceAtLeast(0.5f)

    val topPx = (max(bars.top, 0) / density).roundToInt()
    val bottomPx = (max(bars.bottom, 0) / density).roundToInt()
    val imePx = (max(ime.bottom, 0) / density).roundToInt()
    val leftPx = (max(bars.left, 0) / density).roundToInt()
    val rightPx = (max(bars.right, 0) / density).roundToInt()
    val navMode = detectNavMode(bottomPx)
    val keyboardOpen = if (imePx > 72) "1" else ""

    val script =
      """
      (function(){
        var r = document.documentElement;
        r.style.setProperty('--sat', '${topPx}px');
        r.style.setProperty('--sab', '${bottomPx}px');
        r.style.setProperty('--ime', '${imePx}px');
        r.style.setProperty('--sal', '${leftPx}px');
        r.style.setProperty('--sar', '${rightPx}px');
        r.dataset.androidNav = '${navMode}';
        if ('${keyboardOpen}' === '1') r.dataset.keyboardOpen = '1';
        else delete r.dataset.keyboardOpen;
      })();
      """.trimIndent()
    webView.post { webView.evaluateJavascript(script, null) }
  }

  private fun detectNavMode(bottomInsetDp: Int): String {
    val id = resources.getIdentifier("config_navBarInteractionMode", "integer", "android")
    if (id > 0) {
      return when (resources.getInteger(id)) {
        2 -> "gesture"
        else -> "buttons"
      }
    }
    return if (bottomInsetDp >= 40) "buttons" else "gesture"
  }

  private fun findWebView(root: View): WebView? {
    if (root is WebView) return root
    if (root is ViewGroup) {
      for (i in 0 until root.childCount) {
        val found = findWebView(root.getChildAt(i))
        if (found != null) return found
      }
    }
    return null
  }
}
