package com.nickwoods.pebblenotes.data

import com.squareup.moshi.Json
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path

data class Note(
    val id: String,
    @param:Json(name = "raw_text") val rawText: String,
    val title: String,
    val category: String,
    @param:Json(name = "recorded_at") val recordedAt: Long,
    val source: String,
    val status: String,
    @param:Json(name = "sort_order") val sortOrder: Long = recordedAt,
)

data class NotesResponse(val notes: List<Note>)
data class NewNoteRequest(val transcription: String, val recordedAt: Long = System.currentTimeMillis())
data class EditNoteRequest(val title: String, @param:Json(name = "raw_text") val rawText: String)
data class ReorderNotesRequest(val ids: List<String>)
data class ReorderResponse(val ok: Boolean)

interface NotesApi {
    @GET("api/notes")
    suspend fun notes(@Header("Authorization") authorization: String): NotesResponse

    @POST("api/notes")
    suspend fun createNote(
        @Header("Authorization") authorization: String,
        @Body request: NewNoteRequest,
    ): Note

    @POST("api/notes/{id}/retry")
    suspend fun retryNote(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    ): Note

    @PATCH("api/notes/{id}")
    suspend fun updateNote(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
        @Body request: EditNoteRequest,
    ): Note

    @PUT("api/notes/order")
    suspend fun reorderNotes(
        @Header("Authorization") authorization: String,
        @Body request: ReorderNotesRequest,
    ): ReorderResponse

    companion object {
        fun create(baseUrl: String): NotesApi {
            require(baseUrl.startsWith("https://")) { "Worker URL must begin with https://" }
            require(baseUrl.endsWith('/')) { "Worker URL must end with /" }
            val moshi = Moshi.Builder().addLast(KotlinJsonAdapterFactory()).build()
            return Retrofit.Builder()
                .baseUrl(baseUrl)
                .addConverterFactory(MoshiConverterFactory.create(moshi))
                .build()
                .create(NotesApi::class.java)
        }
    }
}
