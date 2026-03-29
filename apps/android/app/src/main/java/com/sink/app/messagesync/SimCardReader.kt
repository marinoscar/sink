package com.sink.app.messagesync

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SubscriptionManager
import androidx.core.content.ContextCompat
import com.sink.app.api.models.SimInfo
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SimCardReader @Inject constructor(
    @ApplicationContext private val context: Context
) {
    fun readSimCards(): List<SimInfo> {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return emptyList()
        }

        val subscriptionManager = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE)
            as? SubscriptionManager ?: return emptyList()

        return subscriptionManager.activeSubscriptionInfoList?.map { info ->
            SimInfo(
                slotIndex = info.simSlotIndex,
                subscriptionId = info.subscriptionId,
                carrierName = info.carrierName?.toString(),
                phoneNumber = info.number,
                iccId = info.iccId,
                displayName = info.displayName?.toString()
            )
        } ?: emptyList()
    }
}
