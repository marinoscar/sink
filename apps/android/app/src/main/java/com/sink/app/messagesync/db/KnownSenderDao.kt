package com.sink.app.messagesync.db

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface KnownSenderDao {
    @Query("""
        INSERT INTO known_senders (sender, messageCount, lastMessageAt)
        VALUES (:sender, 1, :timestamp)
        ON CONFLICT(sender) DO UPDATE SET
            messageCount = messageCount + 1,
            lastMessageAt = MAX(lastMessageAt, :timestamp)
    """)
    suspend fun upsert(sender: String, timestamp: Long)

    @Query("SELECT * FROM known_senders ORDER BY lastMessageAt DESC")
    fun getAllSorted(): Flow<List<KnownSenderEntity>>

    @Query("SELECT * FROM known_senders ORDER BY lastMessageAt DESC")
    suspend fun getAllList(): List<KnownSenderEntity>
}
