package com.sink.app.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Article
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Message
import androidx.compose.material.icons.filled.Settings
import androidx.compose.ui.graphics.vector.ImageVector

object BottomNavBar {
    fun iconFor(screen: Screen): ImageVector = when (screen) {
        is Screen.MessageSync -> Icons.Default.Message
        is Screen.Senders -> Icons.Default.Block
        is Screen.Logs -> Icons.Default.Article
        is Screen.Settings -> Icons.Default.Settings
    }
}
