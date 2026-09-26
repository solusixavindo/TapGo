allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

// Plugin pihak ketiga (mis. tflite_flutter) menyatakan Java 1.8 sedangkan Kotlin
// memakai JDK 21, dan build rilis gagal dengan "Inconsistent JVM Target
// Compatibility". Kotlin seluruh submodul diseragamkan ke 17 (sama dengan modul
// app); ketidakcocokan sisanya diturunkan menjadi peringatan lewat
// kotlin.jvm.target.validation.mode di gradle.properties. Bytecode 17 aman untuk
// Android karena didesugar oleh D8.
subprojects {
    afterEvaluate {
        // tflite_flutter dikompilasi terhadap android-31, sementara dependensi
        // AndroidX-nya menuntut >= 34 (checkReleaseAarMetadata gagal).
        extensions.findByType(com.android.build.gradle.LibraryExtension::class.java)
            ?.compileSdk = 36
        tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
            compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }
}

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
