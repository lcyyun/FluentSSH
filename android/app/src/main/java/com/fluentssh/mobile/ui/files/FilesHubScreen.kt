package com.fluentssh.mobile.ui.files

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fluentssh.mobile.data.HostProfile
import com.fluentssh.mobile.ui.AppViewModel
import com.fluentssh.mobile.ui.components.*
import com.fluentssh.mobile.ui.theme.LocalFluentColors

@Composable
fun FilesHubScreen(vm: AppViewModel, onBrowse: (HostProfile) -> Unit) {
    val colors = LocalFluentColors.current
    val data by vm.data.collectAsStateWithLifecycle()
    val hosts = data.hosts.sortedWith(compareByDescending<HostProfile> { it.favorite }.thenByDescending { it.lastConnectedAt })

    Column(Modifier.fillMaxSize().background(colors.background)) {
        Column(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("文件", style = MaterialTheme.typography.headlineMedium, color = colors.textPrimary)
                    Spacer(Modifier.height(2.dp))
                    Text("通过 SFTP 浏览远程文件", style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
                }
            }
        }
        if (hosts.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.FolderOpen,
                title = "还没有主机",
                description = "先添加一台 SSH 主机，才能打开它的 SFTP 文件。",
                actionLabel = null,
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(hosts, key = { it.id }) { host ->
                    AppCard(
                        onClick = { onBrowse(host) },
                        contentPadding = PaddingValues(14.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                Modifier
                                    .size(40.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(colors.brandContainer),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    Icons.Outlined.FolderOpen,
                                    contentDescription = null,
                                    tint = colors.onBrandContainer,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    host.name,
                                    style = MaterialTheme.typography.titleSmall,
                                    color = colors.textPrimary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    host.address,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textTertiary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Icon(
                                Icons.Outlined.ChevronRight,
                                contentDescription = null,
                                tint = colors.textTertiary,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}
