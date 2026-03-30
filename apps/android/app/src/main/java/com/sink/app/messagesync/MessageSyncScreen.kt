package com.sink.app.messagesync

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.sink.app.ui.components.StatusCard

private val REQUIRED_PERMISSIONS = buildList {
    add(Manifest.permission.RECEIVE_SMS)
    add(Manifest.permission.READ_SMS)
    add(Manifest.permission.READ_PHONE_STATE)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        add(Manifest.permission.POST_NOTIFICATIONS)
    }
}.toTypedArray()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessageSyncScreen(
    viewModel: MessageSyncViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current

    // Permission state
    var permissionsGranted by remember { mutableStateOf(false) }
    var permissionsDenied by remember { mutableStateOf(false) }

    // Check permissions on composition
    LaunchedEffect(Unit) {
        permissionsGranted = REQUIRED_PERMISSIONS.all { perm ->
            context.checkSelfPermission(perm) == android.content.pm.PackageManager.PERMISSION_GRANTED
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        permissionsGranted = results.values.all { it }
        permissionsDenied = !permissionsGranted
        if (permissionsGranted) {
            viewModel.onPermissionsGranted()
        }
    }

    // Request permissions on first load if not granted, or trigger registration if already granted
    LaunchedEffect(permissionsGranted) {
        if (!permissionsGranted) {
            permissionLauncher.launch(REQUIRED_PERMISSIONS)
        } else {
            viewModel.onPermissionsGranted()
            // Start foreground service for reliable SMS listening
            val serviceIntent = Intent(context, SmsListenerService::class.java)
            context.startForegroundService(serviceIntent)
        }
    }

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
            // Permissions warning
            if (!permissionsGranted) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    )
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Default.Warning,
                                contentDescription = null,
                                modifier = Modifier.size(32.dp),
                                tint = MaterialTheme.colorScheme.error
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Text(
                                text = "Permissions Required",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onErrorContainer
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "SMS and phone permissions are needed to capture and relay messages. " +
                                    "Without these permissions, Message Sync cannot work.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedButton(
                                onClick = { permissionLauncher.launch(REQUIRED_PERMISSIONS) }
                            ) {
                                Text("Grant Permissions")
                            }
                            if (permissionsDenied) {
                                TextButton(
                                    onClick = {
                                        // Open app settings if user denied and needs to grant manually
                                        context.startActivity(
                                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                                                data = Uri.fromParts("package", context.packageName, null)
                                            }
                                        )
                                    }
                                ) {
                                    Text("Open Settings")
                                }
                            }
                        }
                    }
                }
            }

            // Status card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = when {
                        !permissionsGranted -> MaterialTheme.colorScheme.surfaceVariant
                        state.deviceRegistered -> MaterialTheme.colorScheme.primaryContainer
                        else -> MaterialTheme.colorScheme.surfaceVariant
                    }
                )
            ) {
                Row(
                    modifier = Modifier
                        .padding(20.dp)
                        .fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = when {
                            !permissionsGranted -> Icons.Default.SmsFailed
                            state.registrationError != null -> Icons.Default.ErrorOutline
                            state.deviceRegistered -> Icons.Default.CheckCircle
                            else -> Icons.Default.Sync
                        },
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = when {
                            !permissionsGranted -> MaterialTheme.colorScheme.error
                            state.registrationError != null -> MaterialTheme.colorScheme.error
                            state.deviceRegistered -> MaterialTheme.colorScheme.primary
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )
                    Spacer(modifier = Modifier.width(16.dp))
                    Column {
                        Text(
                            text = when {
                                !permissionsGranted -> "Inactive"
                                state.registrationError != null -> "Error"
                                state.deviceRegistered -> "Active"
                                else -> "Connecting..."
                            },
                            style = MaterialTheme.typography.titleLarge,
                            color = when {
                                !permissionsGranted -> MaterialTheme.colorScheme.onSurfaceVariant
                                state.registrationError != null -> MaterialTheme.colorScheme.error
                                state.deviceRegistered -> MaterialTheme.colorScheme.onPrimaryContainer
                                else -> MaterialTheme.colorScheme.onSurfaceVariant
                            }
                        )
                        Text(
                            text = when {
                                !permissionsGranted -> "Permissions not granted"
                                state.registrationError != null -> state.registrationError!!
                                state.deviceRegistered -> "SMS messages are being synced"
                                else -> "Registering device..."
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = when {
                                !permissionsGranted -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                                state.registrationError != null -> MaterialTheme.colorScheme.error.copy(alpha = 0.7f)
                                state.deviceRegistered -> MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                                else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                            }
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

            // Refresh / Retry button
            OutlinedButton(
                onClick = { viewModel.refreshStats() },
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.Refresh, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text(if (!state.deviceRegistered) "Retry Connection" else "Refresh Stats")
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
