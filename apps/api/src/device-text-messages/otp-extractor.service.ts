import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface OtpExtractionResult {
  code: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

const SYSTEM_PROMPT = `You are an OTP extraction engine. Given an SMS or text message, your job is to extract the one-time password (OTP), verification code, security code, PIN, or passcode from it.

Rules:
- OTP codes are typically 4-8 digits, but may also be alphanumeric (e.g., "G-123456").
- If the code has a well-known prefix like "G-" (Google), include only the numeric portion unless the full alphanumeric string is clearly what the user must enter.
- Look for contextual keywords: "code", "OTP", "verification", "security code", "PIN", "passcode", "confirmation code", "one-time", "2FA", "MFA", "authenticate".
- If the message contains multiple candidate codes, return the one most closely associated with verification/authentication language.
- Do NOT extract phone numbers, order numbers, account numbers, monetary amounts, dates, or reference/tracking numbers.
- If the message is clearly promotional, informational, or does not contain any verification/authentication code, set code to null and explain why.

You MUST respond with ONLY a raw JSON object in this exact format — no markdown fences, no explanation outside the JSON:
{"code": "<extracted_code_or_null>", "confidence": "high|medium|low", "reason": "<brief_one_sentence_explanation>"}

Examples:
- Input: "Your verification code is 483921. It expires in 10 minutes."
  Output: {"code": "483921", "confidence": "high", "reason": "Clear verification code labeled explicitly"}
- Input: "G-123456 is your Google verification code."
  Output: {"code": "123456", "confidence": "high", "reason": "Google verification code with G- prefix stripped"}
- Input: "Your order #78432 has shipped! Track at example.com"
  Output: {"code": null, "confidence": "high", "reason": "Message is a shipping notification with an order number, not a verification code"}
- Input: "Account balance: $1,234.56. Last transaction: $50.00 at Store."
  Output: {"code": null, "confidence": "high", "reason": "Financial notification with no verification or authentication code"}`;

@Injectable()
export class OtpExtractorService {
  private readonly logger = new Logger(OtpExtractorService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('llm.apiKey');
    const baseURL = this.configService.get<string>('llm.baseUrl');
    this.model = this.configService.get<string>('llm.model') || 'gpt-4o-mini';

    if (apiKey) {
      this.client = new OpenAI({
        apiKey,
        baseURL: baseURL || undefined,
      });
    } else {
      this.client = null;
      this.logger.warn('LLM API key not configured — OTP extraction disabled');
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async extractOtp(messageBody: string): Promise<OtpExtractionResult> {
    if (!this.client) {
      return { code: null, confidence: 'low', reason: 'OTP extraction not configured (missing LLM API key)' };
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        max_tokens: 150,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: messageBody },
        ],
      });

      const content = response.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('Empty response from LLM');
      }

      return this.parseResponse(content);
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;

      this.logger.error(`OTP extraction failed: ${(error as Error).message}`);
      throw new InternalServerErrorException(
        'OTP extraction service is unavailable. Please try again later.',
      );
    }
  }

  private parseResponse(content: string): OtpExtractionResult {
    try {
      // Strip markdown code fences if present (defensive)
      const cleaned = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(cleaned);

      // Validate shape
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Response is not an object');
      }

      const code = parsed.code === null || parsed.code === 'null' ? null : String(parsed.code);
      const confidence = ['high', 'medium', 'low'].includes(parsed.confidence)
        ? (parsed.confidence as 'high' | 'medium' | 'low')
        : 'low';
      const reason = typeof parsed.reason === 'string' ? parsed.reason : 'No explanation provided';

      return { code, confidence, reason };
    } catch (parseError) {
      this.logger.warn(`Failed to parse LLM response: ${content}`);
      throw new InternalServerErrorException(
        'Failed to parse OTP extraction response. Please try again.',
      );
    }
  }
}
