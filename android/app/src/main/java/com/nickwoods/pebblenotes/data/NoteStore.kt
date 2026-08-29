package com.nickwoods.pebblenotes.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class NoteStore(context: Context) : SQLiteOpenHelper(context, "pebble_notes.db", null, 3) {
    override fun onCreate(database: SQLiteDatabase) {
        database.execSQL(
            """
            CREATE TABLE notes (
                id TEXT PRIMARY KEY NOT NULL,
                raw_text TEXT NOT NULL,
                title TEXT NOT NULL,
                refined_text TEXT NOT NULL,
                category TEXT NOT NULL,
                recorded_at INTEGER NOT NULL,
                source TEXT NOT NULL,
                status TEXT NOT NULL,
                sort_order INTEGER NOT NULL
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(database: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            database.execSQL("ALTER TABLE notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            database.execSQL("UPDATE notes SET sort_order = recorded_at")
        }
        if (oldVersion < 3) {
            database.execSQL("ALTER TABLE notes ADD COLUMN refined_text TEXT NOT NULL DEFAULT ''")
            database.execSQL("UPDATE notes SET refined_text = raw_text WHERE refined_text = ''")
        }
    }

    fun upsertAll(notes: List<Note>) {
        writableDatabase.beginTransaction()
        try {
            notes.forEach { note ->
                writableDatabase.insertWithOnConflict(
                    "notes",
                    null,
                    note.toValues(),
                    SQLiteDatabase.CONFLICT_REPLACE,
                )
            }
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    fun all(): List<Note> = readableDatabase.query(
        "notes",
        null,
        null,
        null,
        null,
        null,
        "sort_order DESC, recorded_at DESC",
    ).use { cursor ->
        val notes = mutableListOf<Note>()
        val id = cursor.getColumnIndexOrThrow("id")
        val rawText = cursor.getColumnIndexOrThrow("raw_text")
        val title = cursor.getColumnIndexOrThrow("title")
        val refinedText = cursor.getColumnIndexOrThrow("refined_text")
        val category = cursor.getColumnIndexOrThrow("category")
        val recordedAt = cursor.getColumnIndexOrThrow("recorded_at")
        val source = cursor.getColumnIndexOrThrow("source")
        val status = cursor.getColumnIndexOrThrow("status")
        val sortOrder = cursor.getColumnIndexOrThrow("sort_order")
        while (cursor.moveToNext()) {
            notes += Note(
                id = cursor.getString(id),
                rawText = cursor.getString(rawText),
                title = cursor.getString(title),
                refinedText = cursor.getString(refinedText),
                category = cursor.getString(category),
                recordedAt = cursor.getLong(recordedAt),
                source = cursor.getString(source),
                status = cursor.getString(status),
                sortOrder = cursor.getLong(sortOrder),
            )
        }
        notes
    }

    fun delete(id: String) {
        writableDatabase.delete("notes", "id = ?", arrayOf(id))
    }

    private fun Note.toValues() = ContentValues().apply {
        put("id", id)
        put("raw_text", rawText)
        put("title", title)
        put("refined_text", refinedText)
        put("category", category)
        put("recorded_at", recordedAt)
        put("source", source)
        put("status", status)
        put("sort_order", sortOrder)
    }
}
