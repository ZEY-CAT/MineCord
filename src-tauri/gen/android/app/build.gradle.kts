plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.minecord.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.minecord.app"
        minSdk = 24
        targetSdk = 34
        manifestPlaceholders["applicationName"] = "android.app.Application"
        versionCode = 1001
        versionName = "1.0.2"
        vectorDrawables.useSupportLibrary = true
    }

    flavorDimensions += "distribution"
    productFlavors {
        create("universal") {
            dimension = "distribution"
        }
    }

    signingConfigs {
        create("release") {
            if (project.hasProperty("MINECORD_ANDROID_KEYSTORE_PATH")) {
                storeFile = file(project.property("MINECORD_ANDROID_KEYSTORE_PATH").toString())
                storePassword = project.property("MINECORD_ANDROID_KEYSTORE_PASSWORD").toString()
                keyAlias = project.property("MINECORD_ANDROID_KEY_ALIAS").toString()
                keyPassword = project.property("MINECORD_ANDROID_KEY_PASSWORD").toString()
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        getByName("debug") {
            isMinifyEnabled = false
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "META-INF/*"
        }
        jniLibs {
            useLegacyPackaging = true
        }
    }

    buildFeatures {
        buildConfig = true
    }

    ndkVersion = "27.0.12077973"
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.fragment:fragment-ktx:1.8.2")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.webkit:webkit:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-livedata-ktx:2.8.4")
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    kotlinOptions {
        freeCompilerArgs += "-Xopt-in=kotlin.RequiresOptIn"
    }
}

apply(from = "tauri.build.gradle.kts")
