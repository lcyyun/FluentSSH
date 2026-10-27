# FluentSSH Android - R8 rules.
# JSch performs reflective crypto and channel plumbing.
-keep class com.jcraft.jsch.** { *; }
-dontwarn com.jcraft.jsch.**
-dontwarn org.ietf.jgss.**
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**

# Kotlin serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }

# Keep data models used by kotlinx serialization.
-keep,includedescriptorclasses class com.fluentssh.mobile.**$$serializer { *; }
-keepclassmembers class com.fluentssh.mobile.** { *** Companion; }
-keepclasseswithmembers class com.fluentssh.mobile.** { kotlinx.serialization.KSerializer serializer(...); }
