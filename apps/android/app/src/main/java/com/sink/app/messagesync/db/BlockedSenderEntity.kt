package com.sink.app.messagesync.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "blocked_senders",
    indices = [Index(value = ["sender"], unique = true)]
)
data class BlockedSenderEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val sender: String,
    val blockedAt: Long = System.currentTimeMillis()
)
