import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Signaturschlüssel liegt außerhalb des Repos: SWAPLINE_KEYSTORE_PROPS oder ~/.swapline-android/keystore.properties
val keyProps = Properties().apply {
    val f = file(System.getenv("SWAPLINE_KEYSTORE_PROPS") ?: (System.getProperty("user.home") + "/.swapline-android/keystore.properties"))
    if (f.isFile) f.inputStream().use { load(it) }
}
val hasReleaseKey = keyProps.getProperty("storeFile") != null

android {
    namespace = "de.arfep.swapline"
    compileSdk = 37

    defaultConfig {
        applicationId = "de.arfep.swapline"
        minSdk = 26
        targetSdk = 37
        versionCode = 14
        versionName = "0.11.0"
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keyProps.getProperty("storeFile"))
                storePassword = keyProps.getProperty("storePassword")
                keyAlias = keyProps.getProperty("keyAlias")
                keyPassword = keyProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else null
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures { compose = true; buildConfig = true }

    // keine Google-Abhängigkeitsdaten in der APK
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }

    packaging {
        resources.excludes += setOf("META-INF/versions/**/OSGI-INF/**", "META-INF/*.kotlin_module", "META-INF/LICENSE*", "META-INF/NOTICE*")
    }

    testOptions { unitTests.all { it.systemProperty("swapline.repo", rootProject.projectDir.parentFile.absolutePath) } }
}

kotlin {
    compilerOptions { jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17 }
}

dependencies {
    // TLS 1.2 mit vorab geteiltem Schlüssel (PSK) – wie der Fernzugriff in Swapline (src/remote.js)
    implementation("org.bouncycastle:bctls-jdk18on:1.86.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.core:core-ktx:1.19.1")

    // QR-Code zum Koppeln: Kamera in der App, Erkennung mit ZXing (ohne Google-Dienste)
    implementation("androidx.camera:camera-camera2:1.6.2")
    implementation("androidx.camera:camera-lifecycle:1.6.2")
    implementation("androidx.camera:camera-view:1.6.2")
    implementation("com.google.zxing:core:3.5.4")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}
