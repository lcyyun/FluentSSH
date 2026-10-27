package com.fluentssh.mobile.ui.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Route
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fluentssh.mobile.ui.components.Hairline
import com.fluentssh.mobile.ui.Routes
import com.fluentssh.mobile.ui.theme.LocalFluentColors
import com.fluentssh.mobile.ui.theme.Motion

private data class BottomTab(val route: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    BottomTab(Routes.HOSTS, "主机", Icons.Outlined.Dns),
    BottomTab(Routes.SESSIONS, "终端", Icons.Outlined.Terminal),
    BottomTab(Routes.FILES, "文件", Icons.Outlined.FolderOpen),
    BottomTab(Routes.TUNNELS, "隧道", Icons.Outlined.Route),
    BottomTab(Routes.MORE, "更多", Icons.Outlined.MoreHoriz),
)

/**
 * 5-slot Android navigation bar: 64dp content + gesture inset, pill indicator,
 * every target is at least 48dp wide.
 */
@Composable
fun FluentBottomBar(currentRoute: String?, onNavigate: (String) -> Unit) {
    val colors = LocalFluentColors.current
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.surface),
    ) {
        Hairline(color = colors.outline)
        Row(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .height(64.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            tabs.forEach { tab ->
                val selected = currentRoute == tab.route
                val indicatorWidth by animateDpAsState(
                    if (selected) 56.dp else 0.dp,
                    animationSpec = tween(Motion.Short),
                    label = "indicator",
                )
                Column(
                    Modifier
                        .weight(1f)
                        .height(64.dp)
                        .clickable { onNavigate(tab.route) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Box(
                        Modifier
                            .width(if (indicatorWidth > 0.dp) indicatorWidth else 56.dp)
                            .height(28.dp)
                            .clip(RoundedCornerShape(999.dp))
                            .background(if (selected) colors.brandContainer else androidx.compose.ui.graphics.Color.Transparent),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            tab.icon,
                            contentDescription = tab.label,
                            tint = if (selected) colors.onBrandContainer else colors.textTertiary,
                            modifier = Modifier.size(22.dp),
                        )
                    }
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = tab.label,
                        style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
                        color = if (selected) colors.brand else colors.textTertiary,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                    )
                }
            }
        }
    }
}
