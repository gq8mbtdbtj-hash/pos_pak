package com.personal.os

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.max
import kotlin.math.roundToInt

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }

    // Fallback if WebView hook is late: pad activity content by system bars.
    val root = findViewById<ViewGroup>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      applyInsetsToCss(findWebView(v), insets)
      // Do not pad the root itself — CSS vars drive the bottom tab safe area.
      insets
    }
    ViewCompat.requestApplyInsets(root)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      applyInsetsToCss(webView, insets)
      insets
    }
    ViewCompat.requestApplyInsets(webView)
  }

  private fun applyInsetsToCss(webView: WebView?, insets: WindowInsetsCompat) {
    if (webView == null) return
    val bars = insets.getInsets(
      WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    )
    val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
    val density = resources.displayMetrics.density.coerceAtLeast(0.5f)

    val top = max(bars.top, 0)
    val bottom = max(max(bars.bottom, ime.bottom), 0)
    val left = max(bars.left, 0)
    val right = max(bars.right, 0)

    val topPx = (top / density).roundToInt()
    val bottomPx = (bottom / density).roundToInt()
    val leftPx = (left / density).roundToInt()
    val rightPx = (right / density).roundToInt()
    val navMode = detectNavMode(bottomPx)

    val script =
      """
      (function(){
        var r = document.documentElement;
        r.style.setProperty('--sat', '${topPx}px');
        r.style.setProperty('--sab', '${bottomPx}px');
        r.style.setProperty('--sal', '${leftPx}px');
        r.style.setProperty('--sar', '${rightPx}px');
        r.dataset.androidNav = '${navMode}';
      })();
      """.trimIndent()
    webView.post { webView.evaluateJavascript(script, null) }
  }

  /**
   * Prefer AOSP config_navBarInteractionMode when present:
   * 0 = 3-button, 1 = 2-button, 2 = gesture.
   * Fallback: taller bottom inset ⇒ buttons.
   */
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
