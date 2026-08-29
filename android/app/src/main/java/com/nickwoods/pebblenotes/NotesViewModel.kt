package com.nickwoods.pebblenotes

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.nickwoods.pebblenotes.data.NewNoteRequest
import com.nickwoods.pebblenotes.data.EditNoteRequest
import com.nickwoods.pebblenotes.data.Note
import com.nickwoods.pebblenotes.data.NotesApi
import com.nickwoods.pebblenotes.data.NoteStore
import com.nickwoods.pebblenotes.data.ReorderNotesRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import retrofit2.HttpException

data class NotesUiState(
    val notes: List<Note> = emptyList(),
    val loading: Boolean = false,
    val submitting: Boolean = false,
    val error: String? = null,
    val configured: Boolean = false,
)

class NotesViewModel(application: Application) : AndroidViewModel(application) {
    private val mutableState = MutableStateFlow(NotesUiState())
    val state = mutableState.asStateFlow()
    private val noteStore = NoteStore(application)
    private var api: NotesApi? = null
    private var token: String = ""
    private var reorderJob: Job? = null

    init {
        viewModelScope.launch {
            val cached = withContext(Dispatchers.IO) { noteStore.all() }
            mutableState.value = mutableState.value.copy(notes = cached)
        }
    }

    fun configure(baseUrl: String, token: String) {
        val normalizedUrl = if (baseUrl.endsWith('/')) baseUrl else "$baseUrl/"
        runCatching { NotesApi.create(normalizedUrl) }
            .onSuccess { notesApi ->
                this.api = notesApi
                this.token = token.trim()
                mutableState.value = mutableState.value.copy(configured = true, error = null)
                refresh()
            }
            .onFailure { error ->
                mutableState.value = mutableState.value.copy(configured = false, error = error.message)
            }
    }

    fun refresh() {
        val notesApi = configuredApi() ?: return
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(loading = true, error = null)
            runCatching {
                val remoteNotes = notesApi.notes(authHeader()).notes
                withContext(Dispatchers.IO) {
                    noteStore.upsertAll(remoteNotes)
                    noteStore.all()
                }
            }.onSuccess { cachedNotes ->
                mutableState.value = NotesUiState(notes = cachedNotes, configured = true)
            }
                .onFailure { error ->
                    mutableState.value = mutableState.value.copy(loading = false, error = friendlyMessage(error))
                }
        }
    }

    fun submitSample(text: String, finished: (Boolean) -> Unit) {
        val notesApi = configuredApi()
        if (notesApi == null) {
            finished(false)
            return
        }
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(submitting = true, error = null)
            runCatching { notesApi.createNote(authHeader(), NewNoteRequest(text.trim())) }
                .onSuccess {
                    mutableState.value = mutableState.value.copy(submitting = false)
                    refresh()
                    finished(true)
                }
                .onFailure { error ->
                    mutableState.value = mutableState.value.copy(submitting = false, error = friendlyMessage(error))
                    finished(false)
                }
        }
    }

    fun clearError() {
        mutableState.value = mutableState.value.copy(error = null)
    }

    fun retry(note: Note) {
        val notesApi = configuredApi() ?: return
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(loading = true, error = null)
            runCatching { notesApi.retryNote(authHeader(), note.id) }
                .onSuccess { updated ->
                    withContext(Dispatchers.IO) { noteStore.upsertAll(listOf(updated)) }
                    mutableState.value = mutableState.value.copy(
                        notes = mutableState.value.notes.map { if (it.id == updated.id) updated else it },
                        loading = false,
                    )
                }
                .onFailure { error ->
                    mutableState.value = mutableState.value.copy(loading = false, error = friendlyMessage(error))
                }
        }
    }

    fun edit(note: Note, title: String, refinedText: String, rawText: String, finished: (Boolean) -> Unit) {
        val notesApi = configuredApi()
        if (notesApi == null) {
            finished(false)
            return
        }
        viewModelScope.launch {
            val edited = note.copy(title = title.trim(), refinedText = refinedText.trim(), rawText = rawText.trim())
            withContext(Dispatchers.IO) { noteStore.upsertAll(listOf(edited)) }
            mutableState.value = mutableState.value.copy(
                notes = mutableState.value.notes.map { if (it.id == edited.id) edited else it },
                error = null,
            )
            runCatching {
                notesApi.updateNote(authHeader(), note.id, EditNoteRequest(edited.title, edited.rawText, edited.refinedText))
            }.onSuccess { saved ->
                withContext(Dispatchers.IO) { noteStore.upsertAll(listOf(saved)) }
                mutableState.value = mutableState.value.copy(
                    notes = mutableState.value.notes.map { if (it.id == saved.id) saved else it },
                )
                finished(true)
            }.onFailure { error ->
                mutableState.value = mutableState.value.copy(error = friendlyMessage(error))
                finished(false)
            }
        }
    }

    fun reorder(visibleNotes: List<Note>) {
        val visibleIds = visibleNotes.mapTo(mutableSetOf(), Note::id)
        val reordered = visibleNotes.iterator()
        val merged = mutableState.value.notes.map { note ->
            if (note.id in visibleIds) reordered.next() else note
        }.mapIndexed { index, note -> note.copy(sortOrder = (mutableState.value.notes.size - index).toLong()) }
        mutableState.value = mutableState.value.copy(notes = merged)
        viewModelScope.launch(Dispatchers.IO) { noteStore.upsertAll(merged) }

        reorderJob?.cancel()
        reorderJob = viewModelScope.launch {
            delay(350)
            val notesApi = configuredApi() ?: return@launch
            runCatching { notesApi.reorderNotes(authHeader(), ReorderNotesRequest(merged.map(Note::id))) }
                .onFailure { error -> mutableState.value = mutableState.value.copy(error = friendlyMessage(error)) }
        }
    }

    private fun configuredApi(): NotesApi? {
        if (api == null || token.isBlank()) {
            mutableState.value = mutableState.value.copy(
                configured = false,
                error = "Open settings and add the Worker URL and app token.",
            )
        }
        return api?.takeIf { token.isNotBlank() }
    }

    private fun authHeader() = "Bearer $token"

    override fun onCleared() {
        reorderJob?.cancel()
        noteStore.close()
        super.onCleared()
    }

    private fun friendlyMessage(error: Throwable): String = when (error) {
        is HttpException -> when (error.code()) {
            401 -> "The app token does not match the Worker token."
            else -> "Server error ${error.code()}."
        }
        else -> error.message ?: "Could not reach the notes service."
    }
}
