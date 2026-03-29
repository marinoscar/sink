package com.sink.app.auth

import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenManager: TokenManager
) : Interceptor {

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

        // If 401, try to refresh token
        if (response.code == 401 && token != null) {
            response.close()
            val newToken = runBlocking { refreshToken() }
            if (newToken != null) {
                val retryRequest = originalRequest.newBuilder()
                    .header("Authorization", "Bearer $newToken")
                    .build()
                return chain.proceed(retryRequest)
            }
        }

        return response
    }

    private suspend fun refreshToken(): String? {
        // Note: this is a simplified refresh. In production, use a separate OkHttpClient
        // to avoid interceptor recursion
        return try {
            tokenManager.updateAccessToken("") // Will be implemented with actual refresh call
            null
        } catch (e: Exception) {
            tokenManager.clearTokens()
            null
        }
    }
}
