package com.fluentssh.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fluentssh.mobile.ui.components.AppBottomSheet
import com.fluentssh.mobile.ui.components.AppTextField
import com.fluentssh.mobile.ui.components.FieldLabel
import com.fluentssh.mobile.ui.components.Hairline
import com.fluentssh.mobile.ui.components.InlineNotice
import com.fluentssh.mobile.ui.components.NoticeTone
import com.fluentssh.mobile.ui.components.PasswordField
import com.fluentssh.mobile.ui.components.PrimaryButton
import com.fluentssh.mobile.ui.components.SecondaryButton
import com.fluentssh.mobile.ui.theme.LocalFluentColors
import androidx.compose.foundation.text.selection.SelectionContainer

/**
 * Global host-key confirmation, keyboard-interactive and password prompts.
 * None of these sheets dismiss on scrim tap: closing requires an explicit
 * cancel/confirm choice.
 */
@Composable
fun InteractionHost(vm: AppViewModel) {
    val hostKey by vm.interaction.hostKeyPrompt.collectAsStateWithLifecycle()
    val keyboard by vm.interaction.keyboardPrompt.collectAsStateWithLifecycle()
    val password by vm.interaction.passwordPrompt.collectAsStateWithLifecycle()

    hostKey?.let { request ->
        key(request.challenge.fingerprint, request.challenge.hostname) {
            HostKeySheet(
                hostname = request.challenge.hostname,
                port = request.challenge.port,
                keyType = request.challenge.keyType,
                fingerprint = request.challenge.fingerprint,
                previousFingerprint = request.challenge.previousFingerprint,
                onCancel = { vm.dismissHostKey(false) },
                onTrust = { vm.dismissHostKey(true) },
            )
        }
    }

    keyboard?.let { request ->
        key(request.destination, request.prompts.size) {
            KeyboardInteractiveSheet(
                title = request.name.ifBlank { "身份验证" },
                instruction = request.instruction,
                prompts = request.prompts,
                onCancel = { vm.dismissKeyboardInteractive(null) },
                onSubmit = { vm.dismissKeyboardInteractive(it) },
            )
        }
    }

    password?.let { request ->
        key(request.message) {
            PasswordSheet(
                message = request.message,
                onCancel = { vm.dismissPassword(null) },
                onSubmit = { vm.dismissPassword(it) },
            )
        }
    }
}

@Composable
private fun HostKeySheet(
    hostname: String,
    port: Int,
    keyType: String,
    fingerprint: String,
    previousFingerprint: String?,
    onCancel: () -> Unit,
    onTrust: () -> Unit,
) {
    val colors = LocalFluentColors.current
    val clipboard = LocalClipboardManager.current
    val changed = previousFingerprint != null
    AppBottomSheet(
        title = if (changed) "主机密钥已变化" else "确认主机密钥",
        subtitle = "首次连接需要核对服务器身份",
        heightFraction = 0.6f,
        dismissible = false,
        onDismissRequest = onCancel,
        footer = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Weighted { SecondaryButton("取消", onCancel) }
                Weighted { PrimaryButton(if (changed) "仍然信任" else "信任并继续", onTrust, destructive = changed) }
            }
        },
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            if (changed) {
                InlineNotice(
                    text = "该主机之前使用过另一把密钥。除非你确认服务器刚更换过密钥，否则这里可能是中间人攻击。",
                    tone = NoticeTone.ERROR,
                )
                Spacer(Modifier.height(12.dp))
            }
            SheetInfoRow("主机", "$hostname:$port")
            SheetInfoRow("密钥类型", keyType)
            Spacer(Modifier.height(4.dp))
            FieldLabel("SHA256 指纹")
            Spacer(Modifier.height(6.dp))
            SelectionContainer {
                Text(
                    text = fingerprint,
                    style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                    color = colors.textPrimary,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (previousFingerprint != null) {
                Spacer(Modifier.height(8.dp))
                FieldLabel("上次记录的指纹")
                Spacer(Modifier.height(4.dp))
                Text(
                    previousFingerprint,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = colors.textTertiary,
                )
            }
            Spacer(Modifier.height(12.dp))
            Row {
                SecondaryButton(
                    text = "复制指纹",
                    onClick = {
                        clipboard.setText(AnnotatedString(fingerprint))
                    },
                    modifier = Modifier.fillMaxWidth(0.55f),
                )
            }
            Spacer(Modifier.height(12.dp))
            Text(
                "提示：指纹应与服务器 /etc/ssh 下主机公钥的 SHA256 值一致。",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textTertiary,
            )
        }
    }
}

@Composable
private fun KeyboardInteractiveSheet(
    title: String,
    instruction: String,
    prompts: List<com.fluentssh.mobile.ssh.KeyboardPrompt>,
    onCancel: () -> Unit,
    onSubmit: (List<String>) -> Unit,
) {
    val values = remember(prompts) { mutableStateListOfStrings(prompts.size) }
    val visible = remember(prompts) { mutableStateListOfBooleans(prompts.size) }
    val colors = LocalFluentColors.current
    AppBottomSheet(
        title = title,
        subtitle = "服务器请求键盘交互认证",
        heightFraction = 0.8f,
        dismissible = false,
        onDismissRequest = onCancel,
        footer = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Weighted { SecondaryButton("取消", onCancel) }
                Weighted { PrimaryButton("继续", { onSubmit(values.toList()) }) }
            }
        },
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            if (instruction.isNotBlank()) {
                InlineNotice(instruction, tone = NoticeTone.INFO)
                Spacer(Modifier.height(12.dp))
            }
            prompts.forEachIndexed { index, prompt ->
                FieldLabel(prompt.text.ifBlank { "输入项 ${index + 1}" })
                Spacer(Modifier.height(6.dp))
                if (prompt.echo) {
                    AppTextField(
                        value = values[index],
                        onValueChange = { values[index] = it },
                        placeholder = prompt.text,
                    )
                } else {
                    PasswordField(
                        value = values[index],
                        onValueChange = { values[index] = it },
                        placeholder = prompt.text.ifBlank { "密码" },
                        visible = visible[index],
                        onToggleVisible = { visible[index] = !visible[index] },
                    )
                }
                Spacer(Modifier.height(12.dp))
            }
            Text(
                "认证信息只发送给当前服务器，不会保存到本机。",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textTertiary,
            )
        }
    }
}

@Composable
private fun PasswordSheet(
    message: String,
    onCancel: () -> Unit,
    onSubmit: (String) -> Unit,
) {
    var value by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    val colors = LocalFluentColors.current
    AppBottomSheet(
        title = "需要密码",
        subtitle = message,
        heightFraction = 0.42f,
        dismissible = false,
        onDismissRequest = onCancel,
        footer = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Weighted { SecondaryButton("取消", onCancel) }
                Weighted {
                    PrimaryButton("继续", { onSubmit(value) }, enabled = value.isNotEmpty())
                }
            }
        },
    ) {
        Column(Modifier.fillMaxWidth()) {
            FieldLabel("密码", required = true)
            Spacer(Modifier.height(6.dp))
            PasswordField(
                value = value,
                onValueChange = { value = it },
                visible = visible,
                onToggleVisible = { visible = !visible },
            )
            Spacer(Modifier.height(10.dp))
            Text(
                "密码仅用于本次连接，不会写入本地存储。",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textTertiary,
            )
        }
    }
}

@Composable
private fun SheetInfoRow(key: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(
            key,
            style = MaterialTheme.typography.bodyMedium,
            color = LocalFluentColors.current.textTertiary,
            modifier = Modifier.width(84.dp),
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            color = LocalFluentColors.current.textPrimary,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun RowScope.Weighted(content: @Composable () -> Unit) {
    androidx.compose.foundation.layout.Box(Modifier.weight(1f)) { content() }
}

private fun mutableStateListOfStrings(size: Int) =
    androidx.compose.runtime.mutableStateListOf<String>().apply {
        repeat(size) { add("") }
    }

private fun mutableStateListOfBooleans(size: Int) =
    androidx.compose.runtime.mutableStateListOf<Boolean>().apply {
        repeat(size) { add(false) }
    }
