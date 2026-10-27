package com.fluentssh.mobile.ssh

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

data class HostKeyPromptUi(
    val challenge: HostKeyChallenge,
    val deferred: CompletableDeferred<Boolean>,
)

data class KeyboardInteractiveUi(
    val destination: String,
    val name: String,
    val instruction: String,
    val prompts: List<KeyboardPrompt>,
    val deferred: CompletableDeferred<List<String>?>,
)

data class PasswordRequestUi(
    val message: String,
    val deferred: CompletableDeferred<String?>,
)

/**
 * Bridges JSch's blocking authentication callbacks to Compose state. Each
 * request is surfaced as a StateFlow value; the global interaction host renders
 * the matching sheet/dialog and completes the deferred.
 */
class InteractionBridge : SshInteraction {

    private val _hostKeyPrompt = MutableStateFlow<HostKeyPromptUi?>(null)
    val hostKeyPrompt: StateFlow<HostKeyPromptUi?> = _hostKeyPrompt.asStateFlow()

    private val _keyboardPrompt = MutableStateFlow<KeyboardInteractiveUi?>(null)
    val keyboardPrompt: StateFlow<KeyboardInteractiveUi?> = _keyboardPrompt.asStateFlow()

    private val _passwordPrompt = MutableStateFlow<PasswordRequestUi?>(null)
    val passwordPrompt: StateFlow<PasswordRequestUi?> = _passwordPrompt.asStateFlow()

    private val _messages = MutableStateFlow<String?>(null)
    val messages: StateFlow<String?> = _messages.asStateFlow()

    private val waitTimeoutMs = 5 * 60_000L

    override fun confirmHostKey(challenge: HostKeyChallenge): Boolean {
        val deferred = CompletableDeferred<Boolean>()
        _hostKeyPrompt.value = HostKeyPromptUi(challenge, deferred)
        val accepted = runBlocking { withTimeoutOrNull(waitTimeoutMs) { deferred.await() } } ?: false
        _hostKeyPrompt.value = null
        return accepted
    }

    override fun respondToKeyboardInteractive(
        destination: String,
        name: String,
        instruction: String,
        prompts: List<KeyboardPrompt>,
    ): List<String>? {
        if (prompts.isEmpty()) return emptyList()
        val deferred = CompletableDeferred<List<String>?>()
        _keyboardPrompt.value = KeyboardInteractiveUi(destination, name, instruction, prompts, deferred)
        val result = runBlocking { withTimeoutOrNull(waitTimeoutMs) { deferred.await() } }
        _keyboardPrompt.value = null
        return result
    }

    override fun requestPassword(message: String): String? {
        val deferred = CompletableDeferred<String?>()
        _passwordPrompt.value = PasswordRequestUi(message, deferred)
        val result = runBlocking { withTimeoutOrNull(waitTimeoutMs) { deferred.await() } }
        _passwordPrompt.value = null
        return result
    }

    override fun showMessage(message: String) {
        _messages.value = message
    }

    fun resolveHostKey(trust: Boolean) {
        _hostKeyPrompt.value?.deferred?.complete(trust)
        _hostKeyPrompt.value = null
    }

    fun resolveKeyboardInteractive(values: List<String>?) {
        _keyboardPrompt.value?.deferred?.complete(values)
        _keyboardPrompt.value = null
    }

    fun resolvePassword(value: String?) {
        _passwordPrompt.value?.deferred?.complete(value)
        _passwordPrompt.value = null
    }

    fun consumeMessage() {
        _messages.value = null
    }
}
