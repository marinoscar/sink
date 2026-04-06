package com.sink.app.messagesync

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sink.app.messagesync.db.BlockedSenderDao
import com.sink.app.messagesync.db.BlockedSenderEntity
import com.sink.app.messagesync.db.KnownSenderDao
import com.sink.app.preferences.AppPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SenderItem(
    val sender: String,
    val messageCount: Int,
    val lastMessageAt: Long,
    val isBlocked: Boolean
)

@HiltViewModel
class SendersViewModel @Inject constructor(
    private val knownSenderDao: KnownSenderDao,
    private val blockedSenderDao: BlockedSenderDao,
    private val appPreferences: AppPreferences
) : ViewModel() {

    val relayPaused: StateFlow<Boolean> = appPreferences.relayPaused
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    val senders: StateFlow<List<SenderItem>> = combine(
        knownSenderDao.getAllSorted(),
        blockedSenderDao.getAll()
    ) { known, blocked ->
        val blockedSet = blocked.map { it.sender }.toSet()
        known.map { sender ->
            SenderItem(
                sender = sender.sender,
                messageCount = sender.messageCount,
                lastMessageAt = sender.lastMessageAt,
                isBlocked = sender.sender in blockedSet
            )
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun toggleRelayPaused() {
        viewModelScope.launch {
            val current = appPreferences.isRelayPaused()
            appPreferences.setRelayPaused(!current)
        }
    }

    fun blockSender(sender: String) {
        viewModelScope.launch {
            blockedSenderDao.insert(BlockedSenderEntity(sender = sender))
        }
    }

    fun unblockSender(sender: String) {
        viewModelScope.launch {
            blockedSenderDao.delete(sender)
        }
    }
}
