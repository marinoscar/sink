package com.sink.app.api.models

import com.google.gson.annotations.SerializedName

// Wrapper for API responses
data class ApiResponse<T>(val data: T)

// Device auth
data class DeviceCodeRequest(
    val clientInfo: ClientInfo? = null
)

data class ClientInfo(
    val deviceName: String? = null,
    val manufacturer: String? = null,
    val model: String? = null,
    val osVersion: String? = null,
    val appVersion: String? = null
)

data class DeviceCodeResponse(
    val deviceCode: String,
    val userCode: String,
    val verificationUri: String,
    val verificationUriComplete: String,
    val expiresIn: Int,
    val interval: Int
)

data class DeviceTokenRequest(
    val deviceCode: String
)

data class DeviceTokenResponse(
    val accessToken: String,
    val refreshToken: String,
    val tokenType: String,
    val expiresIn: Int
)

data class DeviceTokenError(
    val error: String,
    @SerializedName("error_description")
    val errorDescription: String? = null
)

// Device registration
data class RegisterDeviceRequest(
    val name: String,
    val platform: String = "android",
    val manufacturer: String? = null,
    val model: String? = null,
    val osVersion: String? = null,
    val appVersion: String? = null,
    val deviceCodeId: String? = null
)

data class DeviceResponse(
    val id: String,
    val name: String,
    val platform: String,
    val isActive: Boolean
)

// SIM sync
data class SimInfo(
    val slotIndex: Int,
    val subscriptionId: Int,
    val carrierName: String? = null,
    val phoneNumber: String? = null,
    val iccId: String? = null,
    val displayName: String? = null
)

data class SyncSimsRequest(val sims: List<SimInfo>)

// SMS relay
data class SmsItem(
    val sender: String,
    val body: String,
    val smsTimestamp: String,
    val simSubscriptionId: Int? = null,
    val simSlotIndex: Int? = null
)

data class RelaySmsRequest(
    val deviceId: String,
    val messages: List<SmsItem>
)

data class RelaySmsResponse(
    val stored: Int,
    val duplicates: Int
)

// Token refresh
data class RefreshResponse(
    val accessToken: String,
    val expiresIn: Int
)
