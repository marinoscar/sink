package com.sink.app.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import com.sink.app.auth.DeviceAuthScreen
import com.sink.app.auth.DeviceAuthViewModel
import com.sink.app.messagesync.MessageSyncScreen
import com.sink.app.messagesync.SendersScreen
import com.sink.app.logging.LogsScreen
import com.sink.app.settings.SettingsScreen

sealed class Screen(val route: String, val label: String) {
    object MessageSync : Screen("message_sync", "Message Sync")
    object Senders : Screen("senders", "Senders")
    object Logs : Screen("logs", "Logs")
    object Settings : Screen("settings", "Settings")
}

@Composable
fun SinkNavHost() {
    val authViewModel: DeviceAuthViewModel = hiltViewModel()
    val authState by authViewModel.state.collectAsState()

    if (!authState.isAuthenticated) {
        DeviceAuthScreen(viewModel = authViewModel)
        return
    }

    val navController = rememberNavController()
    val bottomNavItems = listOf(Screen.MessageSync, Screen.Senders, Screen.Logs, Screen.Settings)

    Scaffold(
        bottomBar = {
            NavigationBar {
                val navBackStackEntry by navController.currentBackStackEntryAsState()
                val currentDestination = navBackStackEntry?.destination

                bottomNavItems.forEach { screen ->
                    NavigationBarItem(
                        icon = {
                            Icon(
                                imageVector = BottomNavBar.iconFor(screen),
                                contentDescription = screen.label
                            )
                        },
                        label = { Text(screen.label) },
                        selected = currentDestination?.hierarchy?.any { it.route == screen.route } == true,
                        onClick = {
                            navController.navigate(screen.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        }
                    )
                }
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Screen.MessageSync.route,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable(Screen.MessageSync.route) { MessageSyncScreen() }
            composable(Screen.Senders.route) { SendersScreen() }
            composable(Screen.Logs.route) { LogsScreen() }
            composable(Screen.Settings.route) { SettingsScreen() }
        }
    }
}
