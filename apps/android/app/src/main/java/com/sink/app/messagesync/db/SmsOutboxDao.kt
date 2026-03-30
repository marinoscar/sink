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

    /**
     * Find an SMS message from a sender matching the given normalized phone number
     * within a time window. Used by RcsNotificationListener to detect if an SMS
     * was already captured for the same sender (preventing SMS/RCS duplicates).
     *
     * The query normalizes stored sender values by stripping common non-digit chars.
     */
    @Query("""
        SELECT * FROM sms_outbox
        WHERE messageType = 'sms'
          AND smsTimestamp BETWEEN :windowStart AND :windowEnd
          AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(sender, '+', ''), '-', ''), ' ', ''), '(', ''), ')', '') = :normalizedSender
        LIMIT 1
    """)
    suspend fun findSmsBySenderInWindow(
        normalizedSender: String,
        windowStart: Long,
        windowEnd: Long
    ): SmsOutboxEntity?
}
