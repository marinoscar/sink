package com.sink.app.messagesync.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Database(entities = [SmsOutboxEntity::class], version = 1, exportSchema = false)
abstract class SmsOutboxDatabase : RoomDatabase() {
    abstract fun smsOutboxDao(): SmsOutboxDao
}

@Module
@InstallIn(SingletonComponent::class)
object SmsOutboxDatabaseModule {
    @Provides
    @Singleton
    fun provideSmsOutboxDatabase(@ApplicationContext context: Context): SmsOutboxDatabase {
        return Room.databaseBuilder(
            context,
            SmsOutboxDatabase::class.java,
            "sms_outbox.db"
        ).build()
    }

    @Provides
    fun provideSmsOutboxDao(database: SmsOutboxDatabase): SmsOutboxDao {
        return database.smsOutboxDao()
    }
}
