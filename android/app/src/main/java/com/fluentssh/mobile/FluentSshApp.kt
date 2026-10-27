package com.fluentssh.mobile

import android.app.Application
import com.fluentssh.mobile.core.AppContainer

class FluentSshApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
