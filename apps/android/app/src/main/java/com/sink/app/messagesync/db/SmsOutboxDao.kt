package com.sink.app.messagesync.db

import androidx.room.*

@Dao
interface SmsOutboxDao {
    @Insert
    suspend fun insert(message: SmsOutboxEntity)

    @Query("SELECT * FROM sms_outbox WHERE status = 'PENDING' ORDER BY createdAt ASC LIMIT :limit")
    suspend fun getPending(limit: Int = 100): List<SmsOutboxEntity>

    @Query("UPDATE sms_outbox SET status = :status WHERE id IN (:ids)")
    suspend fun updateStatus(ids: List<Long>, status: String)

    @Query("DELETE FROM sms_outbox WHERE status = 'SYNCED' AND createdAt < :cutoff")
    suspend fun cleanupSynced(cutoff: Long)

    @Query("SELECT COUNT(*) FROM sms_outbox WHERE status = 'PENDING'")
    suspend fun pendingCount(): Int

    @Query("SELECT COUNT(*) FROM sms_outbox WHERE status = 'SYNCED'")
    suspend fun syncedCount(): Int
}
