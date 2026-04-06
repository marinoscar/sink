package com.sink.app.api

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DynamicBaseUrlInterceptor @Inject constructor(
    private val environmentManager: EnvironmentManager
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()
        val originalUrl = originalRequest.url

        val baseUrl = environmentManager.getCurrentBaseUrl().toHttpUrl()

        // Rewrite: take the path from the original request and prepend the environment base path
        // Original URL is like http://localhost/auth/device/code
        // Base URL is like https://sink.dev.marin.cr/api
        // Result: https://sink.dev.marin.cr/api/auth/device/code
        val originalPath = originalUrl.encodedPath.removePrefix("/")
        val basePath = baseUrl.encodedPath.removeSuffix("/")
        val newPath = if (basePath.isNotEmpty()) "$basePath/$originalPath" else "/$originalPath"

        val newUrl = originalUrl.newBuilder()
            .scheme(baseUrl.scheme)
            .host(baseUrl.host)
            .port(baseUrl.port)
            .encodedPath(newPath)
            .build()

        val newRequest = originalRequest.newBuilder()
            .url(newUrl)
            .build()

        return chain.proceed(newRequest)
    }
}
