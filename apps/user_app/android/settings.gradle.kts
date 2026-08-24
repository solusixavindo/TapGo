pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    // AGP dipin ke 8.13.x (8.x terakhir): 9.x memaksa android.newDsl=true dan
    // Kotlin bawaan, yang mematahkan DSL `android { }` / blok `kotlin { }`
    // template di app/build.gradle.kts. Di Mac Anda pin ini juga terdownload
    // otomatis dari Google Maven — build tidak bergantung pada versi Android
    // Studio/Flutter bawaan.
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.3.20" apply false
}

include(":app")
