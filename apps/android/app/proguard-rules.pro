-keepattributes Signature
-keepattributes *Annotation*

# Retrofit
-keep class retrofit2.** { *; }
-keepclassmembers class * { @retrofit2.http.* <methods>; }

# Gson
-keep class com.sink.app.api.models.** { *; }

# Room
-keep class * extends androidx.room.RoomDatabase
