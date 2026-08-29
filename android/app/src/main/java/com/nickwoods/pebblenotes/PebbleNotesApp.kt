package com.nickwoods.pebblenotes

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.core.content.edit
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nickwoods.pebblenotes.data.Note
import java.text.DateFormat
import java.util.Date
import kotlin.math.abs
import kotlinx.coroutines.launch

private val Categories = listOf("Thoughts", "TODO", "Ideas", "Words")
private val Tabs = listOf("All") + Categories
private val TerminalGreen = Color(0xFF67FF8F)
private val TerminalBright = Color(0xFFB7FFCA)
private val TerminalDim = Color(0xFF173622)
private val TerminalBlack = Color(0xFF030705)
private val TerminalSurface = Color(0xFF08110B)
private val TerminalError = Color(0xFFFF6B80)

private val AppColors = darkColorScheme(
    primary = TerminalGreen,
    onPrimary = TerminalBlack,
    primaryContainer = TerminalDim,
    onPrimaryContainer = TerminalBright,
    secondary = Color(0xFF55DDAE),
    background = TerminalBlack,
    onBackground = TerminalBright,
    surface = TerminalSurface,
    onSurface = TerminalBright,
    surfaceVariant = Color(0xFF0D1C12),
    onSurfaceVariant = Color(0xFF78B98A),
    outline = Color(0xFF2D7041),
    error = TerminalError,
    errorContainer = Color(0xFF351117),
    onErrorContainer = Color(0xFFFFB3BE),
)

private val AppTypography = Typography().let { base ->
    base.copy(
        titleLarge = base.titleLarge.copy(fontFamily = FontFamily.Monospace),
        titleMedium = base.titleMedium.copy(fontFamily = FontFamily.Monospace),
        titleSmall = base.titleSmall.copy(fontFamily = FontFamily.Monospace),
        bodyLarge = base.bodyLarge.copy(fontFamily = FontFamily.Monospace),
        bodyMedium = base.bodyMedium.copy(fontFamily = FontFamily.Monospace),
        bodySmall = base.bodySmall.copy(fontFamily = FontFamily.Monospace),
        labelLarge = base.labelLarge.copy(fontFamily = FontFamily.Monospace),
        labelMedium = base.labelMedium.copy(fontFamily = FontFamily.Monospace),
        labelSmall = base.labelSmall.copy(fontFamily = FontFamily.Monospace),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PebbleNotesApp(viewModel: NotesViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val preferences = remember { context.getSharedPreferences("connection", 0) }
    var selectedCategory by rememberSaveable { mutableStateOf("All") }
    var showSampleDialog by rememberSaveable { mutableStateOf(false) }
    var showSettingsDialog by rememberSaveable { mutableStateOf(false) }
    var savedUrl by rememberSaveable { mutableStateOf("") }
    var savedToken by rememberSaveable { mutableStateOf("") }
    var editingNote by remember { mutableStateOf<Note?>(null) }
    var editSaving by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        savedUrl = preferences.getString("worker_url", "") ?: ""
        savedToken = preferences.getString("app_token", "") ?: ""
        if (savedUrl.isNotBlank() && savedToken.isNotBlank()) {
            viewModel.configure(savedUrl, savedToken)
        } else {
            showSettingsDialog = true
        }
    }

    MaterialTheme(colorScheme = AppColors, typography = AppTypography) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text("nicks_pebble_notes", fontWeight = FontWeight.Bold, color = TerminalGreen)
                            Text("[ index_01 // local_cache ]", style = MaterialTheme.typography.labelSmall)
                        }
                    },
                    actions = {
                        IconButton(onClick = { showSampleDialog = true }) {
                            Icon(Icons.Outlined.Add, contentDescription = "add note")
                        }
                        IconButton(onClick = viewModel::refresh, enabled = !state.loading) {
                            Icon(Icons.Outlined.Refresh, contentDescription = "refresh notes")
                        }
                        IconButton(onClick = { showSettingsDialog = true }) {
                            Icon(Icons.Outlined.Settings, contentDescription = "connection settings")
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = TerminalBlack),
                )
            },
            containerColor = TerminalBlack,
        ) { insets ->
            Column(modifier = Modifier.fillMaxSize().padding(insets)) {
                CategoryPicker(selectedCategory, state.notes) { selectedCategory = it }
                val visibleNotes = if (selectedCategory == "All") state.notes else state.notes.filter { it.category == selectedCategory }
                ExportRow(selectedCategory, visibleNotes, state.notes)
                state.error?.let { error -> ErrorCard(error, viewModel::clearError) }

                Box(modifier = Modifier.fillMaxSize()) {
                    when {
                        state.loading && state.notes.isEmpty() -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                        visibleNotes.isEmpty() -> EmptyState(selectedCategory, Modifier.align(Alignment.Center))
                        else -> NoteList(
                            notes = visibleNotes,
                            onRetry = viewModel::retry,
                            onEdit = { editingNote = it },
                            onReorder = viewModel::reorder,
                        )
                    }
                    if (state.loading && state.notes.isNotEmpty()) {
                        CircularProgressIndicator(
                            modifier = Modifier.align(Alignment.TopCenter).padding(top = 8.dp),
                            strokeWidth = 2.dp,
                        )
                    }
                }
            }
        }

        editingNote?.let { note ->
            EditNoteDialog(
                note = note,
                saving = editSaving,
                onDismiss = { if (!editSaving) editingNote = null },
                onSave = { title, transcript ->
                    editSaving = true
                    viewModel.edit(note, title, transcript) { success ->
                        editSaving = false
                        if (success) editingNote = null
                    }
                },
            )
        }

        if (showSampleDialog) {
            SampleNoteDialog(
                submitting = state.submitting,
                onDismiss = { if (!state.submitting) showSampleDialog = false },
                onSubmit = { text -> viewModel.submitSample(text) { if (it) showSampleDialog = false } },
            )
        }

        if (showSettingsDialog) {
            ConnectionDialog(
                initialUrl = savedUrl,
                initialToken = savedToken,
                canDismiss = state.configured,
                onDismiss = { showSettingsDialog = false },
                onSave = { url, token ->
                    val normalizedUrl = if (url.endsWith('/')) url else "$url/"
                    savedUrl = normalizedUrl
                    savedToken = token
                    preferences.edit {
                        putString("worker_url", normalizedUrl)
                        putString("app_token", token)
                    }
                    viewModel.configure(normalizedUrl, token)
                    showSettingsDialog = false
                },
            )
        }
    }
}

@Composable
private fun CategoryPicker(selected: String, notes: List<Note>, onSelected: (String) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Tabs.forEach { category ->
            val count = if (category == "All") notes.size else notes.count { it.category == category }
            FilterChip(
                selected = selected == category,
                onClick = { onSelected(category) },
                label = { Text("${category.lowercase()} [$count]") },
                colors = FilterChipDefaults.filterChipColors(
                    containerColor = TerminalSurface,
                    selectedContainerColor = TerminalDim,
                    selectedLabelColor = TerminalGreen,
                ),
            )
        }
    }
}

@Composable
private fun ExportRow(selected: String, visibleNotes: List<Note>, allNotes: List<Note>) {
    val context = LocalContext.current
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp)) {
        OutlinedButton(
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                val text = exportNotes(if (selected == "All") allNotes else visibleNotes)
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("pebble notes", text))
                Toast.makeText(context, "${visibleNotes.size} notes copied", Toast.LENGTH_SHORT).show()
            },
            enabled = visibleNotes.isNotEmpty(),
        ) {
            Icon(Icons.Outlined.ContentCopy, contentDescription = null)
            Text("copy to clipboard")
        }
    }
}

@Composable
private fun NoteList(
    notes: List<Note>,
    onRetry: (Note) -> Unit,
    onEdit: (Note) -> Unit,
    onReorder: (List<Note>) -> Unit,
) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val currentNotes by rememberUpdatedState(notes)
    var draggedId by remember { mutableStateOf<String?>(null) }
    var draggedOffset by remember { mutableFloatStateOf(0f) }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 12.dp, top = 8.dp, end = 12.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        itemsIndexed(notes, key = { _, note -> note.id }) { _, note ->
            val dragging = draggedId == note.id
            NoteCard(
                note = note,
                onRetry = onRetry,
                onEdit = onEdit,
                modifier = Modifier
                    .zIndex(if (dragging) 1f else 0f)
                    .graphicsLayer { translationY = if (dragging) draggedOffset else 0f },
                dragModifier = Modifier.pointerInput(note.id) {
                        detectDragGesturesAfterLongPress(
                            onDragStart = { draggedId = note.id; draggedOffset = 0f },
                            onDragCancel = { draggedId = null; draggedOffset = 0f },
                            onDragEnd = { draggedId = null; draggedOffset = 0f },
                            onDrag = { change, dragAmount ->
                                change.consume()
                                draggedOffset += dragAmount.y
                                val visible = listState.layoutInfo.visibleItemsInfo
                                val draggedInfo = visible.firstOrNull { it.key == draggedId }
                                    ?: return@detectDragGesturesAfterLongPress
                                val draggedCenter = draggedInfo.offset + draggedOffset + draggedInfo.size / 2f
                                val target = visible.minByOrNull { abs(draggedCenter - (it.offset + it.size / 2f)) }
                                if (target != null && target.key != draggedId) {
                                    val latest = currentNotes
                                    val from = latest.indexOfFirst { it.id == draggedId }
                                    val to = latest.indexOfFirst { it.id == target.key }
                                    if (from >= 0 && to >= 0) {
                                        draggedOffset += draggedInfo.offset - target.offset
                                        val moved = latest.toMutableList().apply { add(to, removeAt(from)) }
                                        onReorder(moved)
                                    }
                                }
                                val viewportStart = listState.layoutInfo.viewportStartOffset
                                val viewportEnd = listState.layoutInfo.viewportEndOffset
                                when {
                                    draggedCenter < viewportStart + 100 -> scope.launch { listState.scrollBy(-35f) }
                                    draggedCenter > viewportEnd - 100 -> scope.launch { listState.scrollBy(35f) }
                                }
                            },
                        )
                    },
            )
        }
    }
}

@Composable
private fun NoteCard(
    note: Note,
    onRetry: (Note) -> Unit,
    onEdit: (Note) -> Unit,
    modifier: Modifier = Modifier,
    dragModifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = TerminalSurface),
        border = CardDefaults.outlinedCardBorder(),
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text(
                text = note.title,
                modifier = Modifier.fillMaxWidth().clickable { onEdit(note) },
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = TerminalGreen,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = note.rawText,
                modifier = Modifier.fillMaxWidth().clickable { onEdit(note) },
                style = MaterialTheme.typography.bodyMedium,
            )
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    formatTime(note.recordedAt),
                    modifier = dragModifier.padding(vertical = 8.dp),
                    style = MaterialTheme.typography.labelSmall,
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedButton(
                        onClick = { onRetry(note) },
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                    ) { Text("retry classification") }
                    OutlinedButton(
                        onClick = { /* reserved for a future free-form llm action */ },
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                    ) { Text("ask llm") }
                }
            }
        }
    }
}

@Composable
private fun EditNoteDialog(note: Note, saving: Boolean, onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var title by remember(note.id) { mutableStateOf(note.title) }
    var transcript by remember(note.id) { mutableStateOf(note.rawText) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("edit_note") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("title / summary") },
                    maxLines = 3,
                    enabled = !saving,
                )
                OutlinedTextField(
                    value = transcript,
                    onValueChange = { transcript = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("raw transcript") },
                    minLines = 5,
                    maxLines = 10,
                    enabled = !saving,
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(title, transcript) },
                enabled = title.isNotBlank() && transcript.isNotBlank() && !saving,
            ) { Text(if (saving) "saving..." else "save") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text("cancel") } },
    )
}

@Composable
private fun ErrorCard(error: String, onDismiss: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        color = MaterialTheme.colorScheme.errorContainer,
        shape = MaterialTheme.shapes.small,
    ) {
        Row(
            modifier = Modifier.padding(start = 14.dp, top = 8.dp, end = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(error.lowercase(), modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onErrorContainer)
            TextButton(onClick = onDismiss) { Text("dismiss") }
        }
    }
}

@Composable
private fun EmptyState(category: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(if (category == "All") "no_notes_found" else "no_${category.lowercase()}_found")
        Spacer(Modifier.height(6.dp))
        Text("record with index or tap +", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun SampleNoteDialog(submitting: Boolean, onDismiss: () -> Unit, onSubmit: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("new_note") },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                maxLines = 7,
                label = { Text("transcript") },
                placeholder = { Text("remember to order coffee filters") },
                enabled = !submitting,
            )
        },
        confirmButton = {
            Button(onClick = { onSubmit(text) }, enabled = text.isNotBlank() && !submitting) {
                Text(if (submitting) "sorting..." else "sort_note")
            }
        },
        dismissButton = { OutlinedButton(onClick = onDismiss, enabled = !submitting) { Text("cancel") } },
    )
}

@Composable
private fun ConnectionDialog(
    initialUrl: String,
    initialToken: String,
    canDismiss: Boolean,
    onDismiss: () -> Unit,
    onSave: (String, String) -> Unit,
) {
    var url by remember(initialUrl) { mutableStateOf(initialUrl) }
    var token by remember(initialToken) { mutableStateOf(initialToken) }
    AlertDialog(
        onDismissRequest = { if (canDismiss) onDismiss() },
        title = { Text("connection_config") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("enter worker address and app token")
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("worker_url") },
                    placeholder = { Text("https://example.workers.dev/") },
                )
                OutlinedTextField(
                    value = token,
                    onValueChange = { token = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("app_token") },
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(url.trim(), token.trim()) },
                enabled = url.trim().startsWith("https://") && token.isNotBlank(),
            ) { Text("connect") }
        },
        dismissButton = { if (canDismiss) TextButton(onClick = onDismiss) { Text("cancel") } },
    )
}

private fun exportNotes(notes: List<Note>): String = notes.joinToString("\n\n") { it.rawText }

private fun formatTime(milliseconds: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(milliseconds)).lowercase()
