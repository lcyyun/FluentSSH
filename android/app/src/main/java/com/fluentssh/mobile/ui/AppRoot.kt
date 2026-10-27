package com.fluentssh.mobile.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.fluentssh.mobile.FluentSshApp
import com.fluentssh.mobile.ui.commands.CommandsScreen
import com.fluentssh.mobile.ui.commands.HistoryScreen
import com.fluentssh.mobile.ui.components.FluentBottomBar
import com.fluentssh.mobile.ui.files.FileBrowserScreen
import com.fluentssh.mobile.ui.files.FileEditorScreen
import com.fluentssh.mobile.ui.files.FilesHubScreen
import com.fluentssh.mobile.ui.hosts.HostsScreen
import com.fluentssh.mobile.ui.more.MoreScreen
import com.fluentssh.mobile.ui.security.AuditScreen
import com.fluentssh.mobile.ui.security.KeysScreen
import com.fluentssh.mobile.ui.security.KnownHostsScreen
import com.fluentssh.mobile.ui.security.RecordingsScreen
import com.fluentssh.mobile.ui.sessions.SessionsScreen
import com.fluentssh.mobile.ui.settings.SettingsScreen
import com.fluentssh.mobile.ui.terminal.TerminalScreen
import com.fluentssh.mobile.ui.theme.FluentTheme
import com.fluentssh.mobile.ui.theme.LocalFluentColors
import com.fluentssh.mobile.ui.theme.ThemeMode
import com.fluentssh.mobile.ui.tunnels.TunnelsScreen
import kotlinx.coroutines.delay

@Composable
fun FluentSshAppRoot(app: FluentSshApp) {
    val vm: AppViewModel = viewModel(factory = AppViewModel.factory(app))
    val data by vm.data.collectAsStateWithLifecycle()
    val theme = when (data.settings.theme) {
        "light" -> ThemeMode.LIGHT
        "dark" -> ThemeMode.DARK
        else -> ThemeMode.SYSTEM
    }
    FluentTheme(mode = theme) {
        AppShell(vm)
    }
}

@Composable
private fun AppShell(vm: AppViewModel) {
    val colors = LocalFluentColors.current
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showBottomBar = currentRoute in Routes.bottomTabs
    val darkChrome = currentRoute == Routes.TERMINAL

    // Terminal keeps dark chrome in both app themes, so system bar icons must
    // flip to light there; everywhere else follow the app theme.
    val view = LocalView.current
    SideEffect {
        val window = (view.context as? android.app.Activity)?.window ?: return@SideEffect
        val controller = WindowCompat.getInsetsController(window, view)
        controller.isAppearanceLightStatusBars = colors.isLight && !darkChrome
        controller.isAppearanceLightNavigationBars = colors.isLight && !darkChrome
    }

    var toastText by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        vm.toasts.collect { toastText = it }
    }
    LaunchedEffect(toastText) {
        if (toastText != null) {
            delay(2200)
            toastText = null
        }
    }

    Box(Modifier.fillMaxSize().background(colors.background)) {
        Scaffold(
            containerColor = colors.background,
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            bottomBar = {
                if (showBottomBar) {
                    FluentBottomBar(currentRoute) { route -> navController.navigateTab(route) }
                }
            },
        ) { padding ->
            NavHost(
                navController = navController,
                startDestination = Routes.HOSTS,
                modifier = Modifier.fillMaxSize().padding(padding),
                enterTransition = {
                    slideInHorizontally(animationSpec = tween(220)) { it / 10 } + fadeIn(tween(220))
                },
                exitTransition = { fadeOut(tween(160)) },
                popEnterTransition = { slideInHorizontally(animationSpec = tween(220)) { -it / 10 } + fadeIn(tween(220)) },
                popExitTransition = { slideOutHorizontally(animationSpec = tween(200)) { it / 10 } + fadeOut(tween(160)) },
            ) {
                composable(Routes.HOSTS) {
                    HostsScreen(
                        vm = vm,
                        onConnect = { host ->
                            val session = vm.connect(host)
                            navController.navigate(Routes.terminal(session.id))
                        },
                        onBrowseFiles = { host -> navController.navigate(Routes.files(host.id)) },
                        onOpenTunnels = { navController.navigate(Routes.TUNNELS) },
                        onOpenCommands = { host -> navController.navigate(Routes.commands(host.id)) },
                    )
                }
                composable(Routes.SESSIONS) {
                    SessionsScreen(
                        vm = vm,
                        onOpenSession = { id -> navController.navigate(Routes.terminal(id)) },
                        onGoConnect = { navController.navigateTab(Routes.HOSTS) },
                    )
                }
                composable(Routes.FILES) {
                    FilesHubScreen(
                        vm = vm,
                        onBrowse = { host -> navController.navigate(Routes.files(host.id)) },
                    )
                }
                composable(Routes.TUNNELS) {
                    TunnelsScreen(
                        vm = vm,
                        onGoHosts = { navController.navigateTab(Routes.HOSTS) },
                    )
                }
                composable(Routes.MORE) {
                    MoreScreen(
                        vm = vm,
                        onOpenKeys = { navController.navigate(Routes.KEYS) },
                        onOpenKnownHosts = { navController.navigate(Routes.KNOWN_HOSTS) },
                        onOpenAudit = { navController.navigate(Routes.AUDIT) },
                        onOpenRecordings = { navController.navigate(Routes.RECORDINGS) },
                        onOpenSettings = { navController.navigate(Routes.SETTINGS) },
                        onOpenCommands = { navController.navigate(Routes.commands(null)) },
                        onOpenHistory = { navController.navigate(Routes.HISTORY) },
                    )
                }
                composable(
                    route = Routes.TERMINAL,
                    arguments = listOf(navArgument("sessionId") { type = NavType.StringType }),
                ) { entry ->
                    val sessionId = entry.arguments?.getString("sessionId").orEmpty()
                    TerminalScreen(
                        vm = vm,
                        sessionId = sessionId,
                        onBack = { navController.popBackStack() },
                        onOpenFiles = { session ->
                            navController.navigate(Routes.files(session.host.id))
                        },
                        onSwitchSession = { id ->
                            if (id != sessionId) {
                                navController.navigate(Routes.terminal(id)) {
                                    popUpTo(Routes.TERMINAL) { inclusive = true }
                                }
                            }
                        },
                        onNewSession = { navController.navigateTab(Routes.HOSTS) },
                    )
                }
                composable(
                    route = Routes.FILES_BROWSE,
                    arguments = listOf(navArgument("hostId") { type = NavType.StringType }),
                ) { entry ->
                    val hostId = entry.arguments?.getString("hostId").orEmpty()
                    FileBrowserScreen(
                        vm = vm,
                        hostId = hostId,
                        onBack = { navController.popBackStack() },
                        onEditFile = { path -> navController.navigate(Routes.editor(hostId, path)) },
                    )
                }
                composable(
                    route = Routes.EDITOR,
                    arguments = listOf(
                        navArgument("hostId") { type = NavType.StringType },
                        navArgument("path") { type = NavType.StringType },
                    ),
                ) { entry ->
                    FileEditorScreen(
                        vm = vm,
                        hostId = entry.arguments?.getString("hostId").orEmpty(),
                        path = entry.arguments?.getString("path").orEmpty(),
                        onBack = { navController.popBackStack() },
                    )
                }
                composable(Routes.KEYS) { KeysScreen(vm, onBack = { navController.popBackStack() }) }
                composable(Routes.KNOWN_HOSTS) { KnownHostsScreen(vm, onBack = { navController.popBackStack() }) }
                composable(Routes.AUDIT) { AuditScreen(vm, onBack = { navController.popBackStack() }) }
                composable(Routes.RECORDINGS) { RecordingsScreen(vm, onBack = { navController.popBackStack() }) }
                composable(Routes.SETTINGS) { SettingsScreen(vm, onBack = { navController.popBackStack() }) }
                composable(
                    route = Routes.COMMANDS,
                    arguments = listOf(navArgument("hostId") { type = NavType.StringType; defaultValue = "" }),
                ) { entry ->
                    CommandsScreen(
                        vm = vm,
                        initialHostId = entry.arguments?.getString("hostId").orEmpty(),
                        onBack = { navController.popBackStack() },
                        onOpenHistory = { navController.navigate(Routes.HISTORY) },
                    )
                }
                composable(Routes.HISTORY) { HistoryScreen(vm, onBack = { navController.popBackStack() }) }
            }
        }

        // Lightweight toast-style feedback (1.5–2.5s, never blocks input).
        AnimatedVisibility(
            visible = toastText != null,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = if (showBottomBar) 76.dp else 20.dp),
            enter = fadeIn(tween(160)),
            exit = fadeOut(tween(200)),
        ) {
            Surface(
                color = if (colors.isDark) colors.surfaceContainerHigh else Color(0xE61A1D21),
                shape = RoundedCornerShape(12.dp),
                tonalElevation = 0.dp,
            ) {
                Text(
                    text = toastText.orEmpty(),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (colors.isDark) colors.textPrimary else Color.White,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
        }

        InteractionHost(vm)
    }
}

private fun NavHostController.navigateTab(route: String) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
