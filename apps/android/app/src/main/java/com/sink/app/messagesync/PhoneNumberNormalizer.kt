package com.sink.app.messagesync

/**
 * Normalizes phone numbers by stripping all non-digit characters.
 * Used to compare sender phone numbers between SMS and RCS for deduplication.
 *
 * Examples:
 *   "+1 (248) 805-7580" → "12488057580"
 *   "12488057580"       → "12488057580"
 *   "+12488057580"      → "12488057580"
 *   "UNITED"            → "" (alphanumeric — not a phone number)
 */
object PhoneNumberNormalizer {
    fun normalize(input: String): String = input.replace(Regex("[^\\d]"), "")

    /**
     * Returns true if the normalized input looks like a phone number (4+ digits).
     * Short codes and alphanumeric senders will return false.
     */
    fun isPhoneNumber(input: String): Boolean = normalize(input).length >= 4
}
