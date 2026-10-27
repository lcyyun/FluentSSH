package com.fluentssh.mobile.ui

import android.net.Uri

object Routes {
    const val HOSTS = "hosts"
    const val SESSIONS = "sessions"
    const val FILES = "files"
    const val TUNNELS = "tunnels"
    const val MORE = "more"

    const val TERMINAL = "terminal/{sessionId}"
    const val FILES_BROWSE = "files/{hostId}"
    const val EDITOR = "editor/{hostId}?path={path}"

    const val SETTINGS = "settings"
    const val KEYS = "keys"
    const val KNOWN_HOSTS = "known_hosts"
    const val AUDIT = "audit"
    const val RECORDINGS = "recordings"
    const val COMMANDS = "commands?hostId={hostId}"
    const val HISTORY = "history"

    fun terminal(sessionId: String) = "terminal/$sessionId"
    fun files(hostId: String) = "files/$hostId"
    fun editor(hostId: String, path: String) = "editor/$hostId?path=${Uri.encode(path)}"
    fun commands(hostId: String?) = "commands?hostId=${hostId.orEmpty()}"

    val bottomTabs = setOf(HOSTS, SESSIONS, FILES, TUNNELS, MORE)
}
