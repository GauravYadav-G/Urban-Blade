package com.urbanblade.mobile

import android.app.Activity
import android.content.Intent
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.Executors

/** User-selected document storage; no broad file permission or public temp file. */
class ReceiptExport(private val activity: Activity, messenger: BinaryMessenger) {
    private val channel = MethodChannel(messenger, "com.urbanblade.mobile/receipts")
    private val worker = Executors.newSingleThreadExecutor()
    private var pending: MethodChannel.Result? = null
    private var bytes: ByteArray? = null
    private val request = 8104

    init {
        channel.setMethodCallHandler { call, result ->
            if (call.method != "savePdf") {
                result.notImplemented()
            } else if (pending != null) {
                result.error("busy", "A receipt is already being saved.", null)
            } else {
                val body = call.argument<ByteArray>("bytes")
                val filename = call.argument<String>("filename")
                if (body == null || body.size < 5 || !body.take(5).toByteArray().contentEquals("%PDF-".toByteArray()) || filename.isNullOrBlank()) {
                    result.error("invalid", "Receipt data is missing.", null)
                } else {
                    pending = result
                    bytes = body
                    try {
                        activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "application/pdf"
                            putExtra(Intent.EXTRA_TITLE, filename)
                        }, request)
                    } catch (_: Exception) {
                        pending = null
                        bytes = null
                        result.error("unavailable", "Could not open the save dialog.", null)
                    }
                }
            }
        }
    }

    fun onResult(code: Int, status: Int, data: Intent?): Boolean {
        if (code != request) return false
        val callback = pending ?: return true
        val uri = data?.data
        if (status != Activity.RESULT_OK || uri == null) {
            pending = null
            bytes = null
            callback.success(false)
            return true
        }
        val content = bytes
        bytes = null
        worker.execute {
            try {
                if (content == null) throw IllegalStateException("Receipt data missing")
                activity.contentResolver.openOutputStream(uri, "w")?.use { it.write(content) }
                    ?: throw IllegalStateException("Could not open destination")
                activity.runOnUiThread { if (pending === callback) { pending = null; callback.success(true) } }
            } catch (_: Exception) {
                activity.runOnUiThread {
                    if (pending === callback) {
                        pending = null
                        callback.error("save_failed", "Could not save receipt. Please try another folder.", null)
                    }
                }
            }
        }
        return true
    }

    fun dispose() {
        channel.setMethodCallHandler(null)
        pending?.error("closed", "Receipt export was closed.", null)
        pending = null
        bytes = null
        worker.shutdown()
    }
}
