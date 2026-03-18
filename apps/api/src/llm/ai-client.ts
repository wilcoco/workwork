/**
 * Dual-mode AI Client — Claude (Anthropic) + OpenAI
 *
 * Usage:
 *   const result = await callAI({ system, user, jsonSchema, thinking, model });
 *   // model: 'claude' | 'openai' (default: 'openai')
 */

export type AIModel = 'claude' | 'openai';

export interface CallAIOptions {
  system: string;
  user: string;
  /** If provided, Claude uses tool_use with this schema; OpenAI uses response_format json_object */
  jsonSchema?: { name: string; schema: Record<string, any> };
  /** Enable Claude extended thinking (ignored for OpenAI) */
  thinking?: boolean;
  /** Budget tokens for thinking (default 8000) */
  thinkingBudget?: number;
  /** Temperature (default 0.2) */
  temperature?: number;
  /** Max output tokens */
  maxTokens?: number;
  /** Which model to use */
  model?: AIModel;
}

export interface CallAIResult {
  parsed: any;
  raw: string;
  model: AIModel;
  thinkingText?: string;
}

// ─── OpenAI path ─────────────────────────────────────────
async function callOpenAI(opts: CallAIOptions): Promise<CallAIResult> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  const f: any = (globalThis as any).fetch;
  if (!f) throw new Error('Server fetch not available.');

  const resp = await f('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      temperature: opts.temperature ?? 0.2,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OpenAI error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const raw = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!raw) throw new Error('OpenAI returned empty response');

  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { throw new Error('OpenAI did not return valid JSON'); }

  return { parsed, raw, model: 'openai' };
}

// ─── Claude (Anthropic) path ─────────────────────────────
async function callClaude(opts: CallAIOptions): Promise<CallAIResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY. Set it as a Railway env var.');

  const f: any = (globalThis as any).fetch;
  if (!f) throw new Error('Server fetch not available.');

  const claudeModel = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
  const maxTokens = opts.maxTokens || 4096;

  const body: any = {
    model: claudeModel,
    max_tokens: opts.thinking ? maxTokens + (opts.thinkingBudget || 8000) : maxTokens,
    system: [
      {
        type: 'text',
        text: opts.system,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: opts.user }],
  };

  // Extended Thinking
  if (opts.thinking) {
    body.thinking = {
      type: 'enabled',
      budget_tokens: opts.thinkingBudget || 8000,
    };
    // When thinking is enabled, temperature must be 1 for Claude
    body.temperature = 1;
  } else {
    body.temperature = opts.temperature ?? 0.2;
  }

  // Tool Use for structured JSON output
  if (opts.jsonSchema) {
    body.tools = [{
      name: opts.jsonSchema.name,
      description: `Generate structured JSON output for: ${opts.jsonSchema.name}`,
      input_schema: opts.jsonSchema.schema,
    }];
    body.tool_choice = { type: 'tool', name: opts.jsonSchema.name };
  }

  const resp = await f('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Claude error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const contentBlocks: any[] = data?.content || [];

  // Extract thinking text if present
  const thinkingBlock = contentBlocks.find((b: any) => b.type === 'thinking');
  const thinkingText = thinkingBlock?.thinking || undefined;

  // Tool Use response
  if (opts.jsonSchema) {
    const toolBlock = contentBlocks.find((b: any) => b.type === 'tool_use');
    if (toolBlock?.input) {
      return { parsed: toolBlock.input, raw: JSON.stringify(toolBlock.input), model: 'claude', thinkingText };
    }
  }

  // Text response fallback
  const textBlock = contentBlocks.find((b: any) => b.type === 'text');
  const raw = String(textBlock?.text || '').trim();
  if (!raw) throw new Error('Claude returned empty response');

  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Claude did not return valid JSON'); }

  return { parsed, raw, model: 'claude', thinkingText };
}

// ─── Main entry point ────────────────────────────────────
export async function callAI(opts: CallAIOptions): Promise<CallAIResult> {
  const model = opts.model || 'openai';

  // If Claude requested but no API key, fall back to OpenAI
  if (model === 'claude' && !process.env.ANTHROPIC_API_KEY) {
    console.warn('[ai-client] ANTHROPIC_API_KEY not set, falling back to OpenAI');
    return callOpenAI(opts);
  }

  if (model === 'claude') {
    return callClaude(opts);
  }
  return callOpenAI(opts);
}
