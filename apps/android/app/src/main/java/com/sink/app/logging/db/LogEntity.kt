package com.sink.app.logging.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "app_logs")
data class LogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val feature: String,
    val level: String,
    val message: String,
    val details: String? = null,
    val timestamp: Long = System.currentTimeMillis()
)
