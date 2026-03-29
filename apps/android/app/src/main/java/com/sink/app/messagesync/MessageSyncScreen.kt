package com.sink.app.messagesync

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.sink.app.ui.components.StatusCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessageSyncScreen(
    viewModel: MessageSyncViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()

    Column(modifier = Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("Message Sync") }
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Status card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = if (state.deviceRegistered)
                        MaterialTheme.colorScheme.primaryContainer
                    else
                        MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Row(
                    modifier = Modifier
                        .padding(20.dp)
                        .fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = if (state.deviceRegistered) Icons.Default.CheckCircle
                        else Icons.Default.Sync,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = if (state.deviceRegistered)
                            MaterialTheme.colorScheme.primary
                        else
                            MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.width(16.dp))
                    Column {
                        Text(
                            text = if (state.deviceRegistered) "Active" else "Connecting...",
                            style = MaterialTheme.typography.titleLarge,
                            color = if (state.deviceRegistered)
                                MaterialTheme.colorScheme.onPrimaryContainer
                            else
                                MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            text = if (state.deviceRegistered)
                                "SMS messages are being synced"
                            else
                                "Registering device...",
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (state.deviceRegistered)
                                MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                            else
                                MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                        )
                    }
                }
            }

            // Stats
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                StatusCard(
                    title = "Pending",
                    value = state.pendingCount.toString(),
                    icon = Icons.Default.Schedule,
                    modifier = Modifier.weight(1f)
                )
                StatusCard(
                    title = "Synced",
                    value = state.syncedCount.toString(),
                    icon = Icons.Default.CloudDone,
                    modifier = Modifier.weight(1f)
                )
            }

            // Refresh button
            OutlinedButton(
                onClick = { viewModel.refreshStats() },
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.Refresh, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Refresh Stats")
            }

            // Info section
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "How it works",
                        style = MaterialTheme.typography.titleSmall
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "When an SMS arrives on this device, it is automatically captured and queued for sync. " +
                                "Messages are batched and sent to the server when a network connection is available. " +
                                "You can view your messages on the web app.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}
