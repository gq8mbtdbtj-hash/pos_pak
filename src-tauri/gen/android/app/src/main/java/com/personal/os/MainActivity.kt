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

/**
 * Soft-keyboard handling for Android 15+ edge-to-edge (targetSdk 36).
 *
 * Pad [android.R.id.content] by IME height so the WebView sits above the keyboard.
 * While the keyboard is open, expose `--sab: 0` so CSS does not add a second
 * bottom gap (that empty strip looked like a blank tab bar).
 */
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)

    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }

    val root = findViewById<ViewGroup>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      applyImePadding(v, insets)
      applyInsetsToCss(findWebView(v), insets)
      insets
    }

    ViewCompat.setWindowInsetsAnimationCallback(
      root,
      object : WindowInsetsAnimationCompat.Callback(
        WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE,
      ) {
        override fun onProgress(
          insets: WindowInsetsCompat,
          runningAnimations: MutableList<WindowInsetsAnimationCompat>,
        ): WindowInsetsCompat {
          applyImePadding(root, insets)
          applyInsetsToCss(findWebView(root), insets)
          return insets
        }
      },
    )

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
      WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
    )
    val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
    val density = resources.displayMetrics.density.coerceAtLeast(0.5f)

    val topPx = (max(bars.top, 0) / density).roundToInt()
    val systemBottomPx = (max(bars.bottom, 0) / density).roundToInt()
    val imePx = (max(ime.bottom, 0) / density).roundToInt()
    val leftPx = (max(bars.left, 0) / density).roundToInt()
    val rightPx = (max(bars.right, 0) / density).roundToInt()
    val navMode = detectNavMode(systemBottomPx)

    val imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
    val keyboardOpen = imeVisible && imePx > 100
    // While IME is up, content is already clear of the system nav — zero --sab
    // so the dock does not leave a blank strip above the keyboard.
    val sabPx = if (keyboardOpen) 0 else systemBottomPx
    val keyboardFlag = if (keyboardOpen) "1" else ""

    val script =
      """
      (function(){
        var r = document.documentElement;
        r.style.setProperty('--sat', '${topPx}px');
        r.style.setProperty('--sab', '${sabPx}px');
        r.style.setProperty('--ime', '${imePx}px');
        r.style.setProperty('--sal', '${leftPx}px');
        r.style.setProperty('--sar', '${rightPx}px');
        r.dataset.androidNav = '${navMode}';
        if ('${keyboardFlag}' === '1') r.dataset.keyboardOpen = '1';
        else delete r.dataset.keyboardOpen;
        try {
          window.dispatchEvent(new CustomEvent('personal-os-ime', {
            detail: { ime: ${imePx}, open: ${if (keyboardOpen) "true" else "false"} }
          }));
        } catch (e) {}
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

  private fun findWebView(root: View?): WebView? {
    if (root == null) return null
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
