package com.sink.app.api

import com.sink.app.api.models.*
import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    // Device Authorization Flow
    @POST("auth/device/code")
    suspend fun requestDeviceCode(@Body request: DeviceCodeRequest): ApiResponse<DeviceCodeResponse>

    @POST("auth/device/token")
    suspend fun pollDeviceToken(@Body request: DeviceTokenRequest): Response<ApiResponse<DeviceTokenResponse>>

    @POST("auth/refresh")
    suspend fun refreshToken(): ApiResponse<RefreshResponse>

    // Device Text Messages - Relay
    @POST("device-text-messages/devices/register")
    suspend fun registerDevice(@Body request: RegisterDeviceRequest): ApiResponse<DeviceResponse>

    @POST("device-text-messages/devices/{deviceId}/sims")
    suspend fun syncSims(
        @Path("deviceId") deviceId: String,
        @Body request: SyncSimsRequest
    ): ApiResponse<List<SimInfo>>

    @POST("device-text-messages/relay")
    suspend fun relaySms(@Body request: RelaySmsRequest): ApiResponse<RelaySmsResponse>

    @GET("device-text-messages/devices")
    suspend fun listDevices(): ApiResponse<List<DeviceResponse>>
}
