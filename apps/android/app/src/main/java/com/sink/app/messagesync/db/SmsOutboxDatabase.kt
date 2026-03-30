package com.sink.app.messagesync.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Database(
    entities = [
        SmsOutboxEntity::class,
        BlockedSenderEntity::class,
        KnownSenderEntity::class
    ],
    version = 3,
    exportSchema = false
)
abstract class SmsOutboxDatabase : RoomDatabase() {
    abstract fun smsOutboxDao(): SmsOutboxDao
    abstract fun blockedSenderDao(): BlockedSenderDao
    abstract fun knownSenderDao(): KnownSenderDao

    companion object {
        @Volatile
        private var INSTANCE: SmsOutboxDatabase? = null

        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `blocked_senders` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `sender` TEXT NOT NULL,
                        `blockedAt` INTEGER NOT NULL
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    "CREATE UNIQUE INDEX IF NOT EXISTS `index_blocked_senders_sender` ON `blocked_senders` (`sender`)"
                )

                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `known_senders` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `sender` TEXT NOT NULL,
                        `messageCount` INTEGER NOT NULL DEFAULT 1,
                        `lastMessageAt` INTEGER NOT NULL
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    "CREATE UNIQUE INDEX IF NOT EXISTS `index_known_senders_sender` ON `known_senders` (`sender`)"
                )
            }
        }

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE sms_outbox ADD COLUMN messageType TEXT NOT NULL DEFAULT 'sms'")
            }
        }

        fun getInstance(context: Context): SmsOutboxDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    SmsOutboxDatabase::class.java,
                    "sms_outbox.db"
                )
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}

@Module
@InstallIn(SingletonComponent::class)
object SmsOutboxDatabaseModule {
    @Provides
    @Singleton
    fun provideSmsOutboxDatabase(@ApplicationContext context: Context): SmsOutboxDatabase {
        return SmsOutboxDatabase.getInstance(context)
    }

    @Provides
    fun provideSmsOutboxDao(database: SmsOutboxDatabase): SmsOutboxDao {
        return database.smsOutboxDao()
    }

    @Provides
    fun provideBlockedSenderDao(database: SmsOutboxDatabase): BlockedSenderDao {
        return database.blockedSenderDao()
    }

    @Provides
    fun provideKnownSenderDao(database: SmsOutboxDatabase): KnownSenderDao {
        return database.knownSenderDao()
    }
}
