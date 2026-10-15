package com.urbanblade.mobile

import android.content.Context
import android.content.Intent
import io.flutter.embedding.engine.FlutterEngine
import android.os.Build
import android.os.PowerManager
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    private lateinit var receiptExport: ReceiptExport

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        receiptExport = ReceiptExport(this, flutterEngine.dartExecutor.binaryMessenger)
    }

    @Deprecated("Android activity result bridge")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (::receiptExport.isInitialized && receiptExport.onResult(requestCode, resultCode, data)) return
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onDestroy() {
        if (::receiptExport.isInitialized) receiptExport.dispose()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        window.decorView.post { preferHighRefreshRate() }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) preferHighRefreshRate()
    }

    override fun onPause() {
        window.attributes = window.attributes.apply { preferredRefreshRate = 0f }
        super.onPause()
    }

    @Suppress("DEPRECATION")
    private fun preferHighRefreshRate() {
        val power = getSystemService(Context.POWER_SERVICE) as PowerManager
        val currentDisplay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            display
        } else {
            windowManager.defaultDisplay
        } ?: return
        val current = currentDisplay.mode
        val maximum = currentDisplay.supportedModes
            .filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
            .maxOfOrNull { it.refreshRate } ?: current.refreshRate
        // This is a preference, never a forced mode/resolution switch. Android
        // retains control for battery saver, thermal limits and user settings.
        window.attributes = window.attributes.apply {
            preferredRefreshRate = if (power.isPowerSaveMode) 0f else maximum
        }
    }
}
