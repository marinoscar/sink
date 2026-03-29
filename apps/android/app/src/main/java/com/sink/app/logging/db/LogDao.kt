package com.sink.app.logging.db

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface LogDao {
    @Insert
    suspend fun insert(log: LogEntity)

    @Query("SELECT * FROM app_logs WHERE feature = :feature ORDER BY timestamp DESC")
    fun getByFeature(feature: String): Flow<List<LogEntity>>

    @Query("SELECT * FROM app_logs ORDER BY timestamp DESC")
    fun getAll(): Flow<List<LogEntity>>

    @Query("SELECT * FROM app_logs WHERE feature = :feature ORDER BY timestamp DESC")
    suspend fun getByFeatureList(feature: String): List<LogEntity>

    @Query("SELECT * FROM app_logs ORDER BY timestamp DESC")
    suspend fun getAllList(): List<LogEntity>

    @Query("DELETE FROM app_logs WHERE timestamp < :cutoffTimestamp")
    suspend fun deleteOlderThan(cutoffTimestamp: Long)

    @Query("DELETE FROM app_logs")
    suspend fun deleteAll()

    @Query("SELECT COUNT(*) FROM app_logs")
    suspend fun count(): Int
}
