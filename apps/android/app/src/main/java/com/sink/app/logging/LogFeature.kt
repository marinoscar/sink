package com.sink.app.logging

enum class LogFeature(val displayName: String) {
    MESSAGE_SYNC("Message Sync"),
    DEVICE_AUTH("Device Auth"),
    GENERAL("General");

    companion object {
        fun all() = entries.toList()
    }
}
