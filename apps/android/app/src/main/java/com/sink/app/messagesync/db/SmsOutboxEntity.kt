package com.sink.app.messagesync.db

import androidx.room.*

enum class OutboxStatus { PENDING, SYNCED, FAILED }

@Entity(tableName = "sms_outbox")
data class SmsOutboxEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val sender: String,
    val body: String,
    val smsTimestamp: Long,
    val subscriptionId: Int = -1,
    val simSlotIndex: Int = -1,
    val status: String = OutboxStatus.PENDING.name,
    val createdAt: Long = System.currentTimeMillis()
)
