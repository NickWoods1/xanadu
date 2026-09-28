package com.nickwoods.pebblenotes.data

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

object NoteEvents {
    private val client = OkHttpClient.Builder().pingInterval(30, TimeUnit.SECONDS).build()

    fun updates(baseUrl: String, token: String) = callbackFlow {
        val request = Request.Builder()
            .url("${baseUrl}api/events")
            .header("Authorization", "Bearer $token")
            .build()
        val socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text == "notes_changed") trySend(Unit)
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                close(t)
            }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
                close(IOException("Live connection closed"))
            }
        })
        awaitClose { socket.cancel() }
    }
}
