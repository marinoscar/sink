package com.sink.app.messagesync.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "known_senders",
    indices = [Index(value = ["sender"], unique = true)]
)
data class KnownSenderEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val sender: String,
    val messageCount: Int = 1,
    val lastMessageAt: Long = System.currentTimeMillis()
)
