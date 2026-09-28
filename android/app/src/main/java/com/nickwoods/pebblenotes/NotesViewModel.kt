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
import com.nickwoods.pebblenotes.data.NoteEvents
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.retryWhen
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
    val driveSummary: String = "Checking Google Drive connection…",
    val driveConnecting: Boolean = false,
)

class NotesViewModel(application: Application) : AndroidViewModel(application) {
    private val mutableState = MutableStateFlow(NotesUiState())
    val state = mutableState.asStateFlow()
    private val noteStore = NoteStore(application)
    private var api: NotesApi? = null
    private var token: String = ""
    private var reorderJob: Job? = null
    private var liveJob: Job? = null
    private var fallbackJob: Job? = null
    private var refreshJob: Job? = null
    private var refreshPending = false
    private var foreground = false
    private var baseUrl = ""
    private var localRevision = 0L
    private var activeMutations = 0

    fun startLiveUpdates() {
        foreground = true
        refreshDriveStatus()
        if (api == null || token.isBlank() || liveJob != null) return
        liveJob = viewModelScope.launch {
            NoteEvents.updates(baseUrl, token)
                .retryWhen { _, attempt ->
                    delay((1_000L * (1L shl attempt.coerceAtMost(5).toInt())).coerceAtMost(30_000L))
                    true
                }
                .collect { refresh(silent = true) }
        }
        fallbackJob = viewModelScope.launch {
            while (true) {
                refresh(silent = true)
                refreshDriveStatus()
                delay(60_000)
            }
        }
    }

    fun refreshDriveStatus() {
        val notesApi = api ?: return
        viewModelScope.launch {
            try {
                val status = notesApi.driveStatus(authHeader())
                val pending = status.uploads.filter { it.status != "uploaded" }.sumOf { it.count }
                val uploaded = status.uploads.filter { it.status == "uploaded" }.sumOf { it.count }
                val summary = when {
                    !status.configured -> "Google setup is needed on the server before you can connect."
                    !status.connected -> "Connect your Google account to save Lain notes in your chosen folder."
                    else -> "Connected as ${status.connection?.email}. $uploaded uploaded; $pending waiting."
                }
                mutableState.value = mutableState.value.copy(driveSummary = summary + (status.error?.let { "\n$it" } ?: ""))
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(driveSummary = friendlyMessage(error))
            }
        }
    }

    fun connectDrive(openBrowser: (String) -> Unit) {
        val notesApi = configuredApi() ?: return
        if (mutableState.value.driveConnecting) return
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(driveConnecting = true)
            try {
                openBrowser(notesApi.connectDrive(authHeader()).url)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                val message = if (error is HttpException && error.code() == 503) {
                    "Google setup is needed on the server before you can connect."
                } else friendlyMessage(error)
                mutableState.value = mutableState.value.copy(driveSummary = message)
            } finally {
                mutableState.value = mutableState.value.copy(driveConnecting = false)
            }
        }
    }

    fun stopLiveUpdates() {
        foreground = false
        liveJob?.cancel()
        liveJob = null
        fallbackJob?.cancel()
        fallbackJob = null
    }

    init {
        viewModelScope.launch {
            val cached = withContext(Dispatchers.IO) { noteStore.all() }
            if (mutableState.value.notes.isEmpty()) {
                mutableState.value = mutableState.value.copy(notes = cached)
            }
        }
    }

    fun configure(baseUrl: String, token: String) {
        val normalizedUrl = if (baseUrl.endsWith('/')) baseUrl else "$baseUrl/"
        runCatching { NotesApi.create(normalizedUrl) }
            .onSuccess { notesApi ->
                val wasForeground = foreground
                stopLiveUpdates()
                refreshJob?.cancel()
                this.baseUrl = normalizedUrl
                this.api = notesApi
                this.token = token.trim()
                mutableState.value = mutableState.value.copy(configured = true, error = null)
                refresh()
                if (wasForeground) startLiveUpdates()
            }
            .onFailure { error ->
                mutableState.value = mutableState.value.copy(configured = false, error = error.message)
            }
    }

    fun refresh() = refresh(silent = false)

    private fun refresh(silent: Boolean) {
        val notesApi = configuredApi() ?: return
        if (refreshJob?.isActive == true) {
            refreshPending = true
            return
        }
        refreshJob = viewModelScope.launch {
            do {
                refreshPending = false
                if (reorderJob?.isActive == true) reorderJob?.join()
                if (activeMutations > 0) {
                    delay(250)
                    refreshPending = true
                    continue
                }
                val revision = localRevision
                if (!silent) mutableState.value = mutableState.value.copy(loading = true, error = null)
                try {
                    val remoteNotes = notesApi.notes(authHeader()).notes
                    // A local edit or drag made during the fetch takes precedence.
                    if (revision == localRevision) {
                        withContext(Dispatchers.IO) { noteStore.upsertAll(remoteNotes) }
                        if (revision == localRevision) {
                            mutableState.value = mutableState.value.copy(notes = remoteNotes)
                        } else refreshPending = true
                    } else refreshPending = true
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    if (!silent) mutableState.value = mutableState.value.copy(error = friendlyMessage(error))
                } finally {
                    if (!silent) mutableState.value = mutableState.value.copy(loading = false)
                }
            } while (refreshPending)
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
        localRevision++
        val notesApi = configuredApi() ?: return
        viewModelScope.launch {
            activeMutations++
            try {
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
            } finally {
                activeMutations--
                localRevision++
            }
        }
    }

    fun delete(note: Note) {
        localRevision++
        val notesApi = configuredApi() ?: return
        viewModelScope.launch {
            activeMutations++
            try {
                mutableState.value = mutableState.value.copy(loading = true, error = null)
                runCatching { notesApi.deleteNote(authHeader(), note.id) }
                    .onSuccess {
                        withContext(Dispatchers.IO) { noteStore.delete(note.id) }
                        mutableState.value = mutableState.value.copy(
                            notes = mutableState.value.notes.filterNot { it.id == note.id },
                            loading = false,
                        )
                    }
                    .onFailure { error ->
                        mutableState.value = mutableState.value.copy(loading = false, error = friendlyMessage(error))
                    }
            } finally {
                activeMutations--
                localRevision++
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
            activeMutations++
            try {
                localRevision++
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
            } finally {
                activeMutations--
                localRevision++
            }
        }
    }

    fun reorder(visibleNotes: List<Note>) {
        localRevision++
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
        stopLiveUpdates()
        refreshJob?.cancel()
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
