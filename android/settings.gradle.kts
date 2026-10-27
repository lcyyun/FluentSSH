pluginManagement {
    repositories {
        google()
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        maven { url = uri("https://repo.huaweicloud.com/repository/maven/") }
        maven { url = uri("https://maven.aliyun.com/repository/central") }
        mavenCentral()
    }
}

rootProject.name = "FluentSSH"
include(":app")
