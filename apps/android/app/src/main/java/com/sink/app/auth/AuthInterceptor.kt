package com.sink.app.auth

import com.sink.app.api.EnvironmentManager
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenManager: TokenManager,
    private val environmentManager: EnvironmentManager
) : Interceptor {

    // Separate client for refresh calls to avoid interceptor recursion
    private val refreshClient = OkHttpClient.Builder().build()

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        // Skip auth for device code and token polling endpoints
        val path = originalRequest.url.encodedPath
        if (path.contains("auth/device/code") || path.contains("auth/device/token")) {
            return chain.proceed(originalRequest)
        }

        val token = runBlocking { tokenManager.getAccessToken() }

        val request = if (token != null) {
            originalRequest.newBuilder()
                .header("Authorization", "Bearer $token")
                .build()
        } else {
            originalRequest
        }

        val response = chain.proceed(request)

        // If 401, try to refresh token and retry once
        if (response.code == 401 && token != null) {
            response.close()
            val newToken = runBlocking { refreshToken() }
            if (newToken != null) {
                val retryRequest = originalRequest.newBuilder()
                    .header("Authorization", "Bearer $newToken")
                    .build()
                return chain.proceed(retryRequest)
            }
            // Refresh failed — return a fresh 401 so the caller gets a valid response
            return chain.proceed(request)
        }

        return response
    }

    private suspend fun refreshToken(): String? {
        val refreshTokenValue = tokenManager.getRefreshToken() ?: return null

        return try {
            val refreshRequest = Request.Builder()
                .url(environmentManager.getCurrentBaseUrl() + "/auth/refresh")
                .post("{}".toRequestBody("application/json".toMediaType()))
                .header("Cookie", "refresh_token=$refreshTokenValue")
                .build()

            val response = refreshClient.newCall(refreshRequest).execute()
            if (response.isSuccessful) {
                val body = response.body?.string() ?: return null
                val json = JSONObject(body)
                val data = json.getJSONObject("data")
                val newAccessToken = data.getString("accessToken")
                tokenManager.updateAccessToken(newAccessToken)

                // Extract new refresh token from Set-Cookie if present
                val setCookie = response.header("Set-Cookie")
                if (setCookie != null && setCookie.contains("refresh_token=")) {
                    val newRefreshToken = setCookie
                        .substringAfter("refresh_token=")
                        .substringBefore(";")
                    tokenManager.saveTokens(newAccessToken, newRefreshToken)
                }

                newAccessToken
            } else {
                // Refresh token is invalid/expired — clear auth state
                tokenManager.clearTokens()
                null
            }
        } catch (e: Exception) {
            null
        }
    }
}
