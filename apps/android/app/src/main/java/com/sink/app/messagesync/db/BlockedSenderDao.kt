package com.sink.app.messagesync.db

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface BlockedSenderDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: BlockedSenderEntity)

    @Query("DELETE FROM blocked_senders WHERE sender = :sender")
    suspend fun delete(sender: String)

    @Query("SELECT * FROM blocked_senders ORDER BY blockedAt DESC")
    fun getAll(): Flow<List<BlockedSenderEntity>>

    @Query("SELECT COUNT(*) > 0 FROM blocked_senders WHERE sender = :sender")
    suspend fun isBlocked(sender: String): Boolean

    @Query("SELECT * FROM blocked_senders ORDER BY blockedAt DESC")
    suspend fun getAllList(): List<BlockedSenderEntity>
}
