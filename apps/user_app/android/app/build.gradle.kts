import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
val hasReleaseSigning = keystorePropertiesFile.exists()
if (hasReleaseSigning) {
    keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}

android {
    namespace = "com.xavindo.tapgo"
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.xavindo.tapgo"
        minSdk = flutter.minSdkVersion
        targetSdk = 36
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            // Signing release dipasang HANYA bila materialnya benar-benar ada.
            // Bila tidak ada, penjaga di bawah menghentikan build release
            // sebelum satu pun task berjalan — sehingga release tidak pernah
            // diam-diam memakai debug signing.
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        // Debug sengaja tidak menyentuh material release sama sekali dan
        // memakai debug keystore bawaan Android.
    }
}

/**
 * Penjaga release signing, dievaluasi pada waktu EKSEKUSI.
 *
 * Sebelumnya penjaga ini berupa `throw` di dalam blok `release { }`. Gradle
 * mengonfigurasi SELURUH build type pada setiap invocation, sehingga
 * `flutter build apk --debug` pun ikut gagal ketika key.properties tidak ada.
 * Akibatnya build debug mustahil dijalankan di lingkungan mana pun yang tidak
 * memegang material signing produksi — termasuk CI dan worktree bersih.
 *
 * Task graph hanya memuat task yang benar-benar akan dijalankan, sehingga
 * pemeriksaan di sini menyentuh build release saja.
 */
gradle.taskGraph.whenReady {
    val releaseRequested = allTasks.any { task ->
        task.project == project && task.name.contains("Release", ignoreCase = false)
    }

    if (releaseRequested && !hasReleaseSigning) {
        // Pesan menyebut nama berkas relatif yang perlu dibuat, tanpa path
        // absolut, isi keystore, alias, maupun password.
        throw GradleException(
            "Release signing is not configured. Create android/key.properties and the upload keystore referenced by it before building release."
        )
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
