import { Global, Module } from '@nestjs/common';
import { LlmClientService } from './llm-client.service.js';

/**
 * Global module exposing the {@link LlmClientService} to every feature module
 * so any place that previously talked to Gemini/Groq can use the unified,
 * env-selectable LLM gateway without re-importing it everywhere.
 */
@Global()
@Module({
  providers: [LlmClientService],
  exports: [LlmClientService],
})
export class LlmClientModule {}
