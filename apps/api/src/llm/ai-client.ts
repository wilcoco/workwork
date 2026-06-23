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
      model: 'gpt-4.1',
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

  // Default to Claude Opus 4.8 (latest top-tier) for the highest quality analysis.
  // Override via CLAUDE_MODEL env if a cheaper/faster model is desired (e.g. claude-sonnet-4-6).
  const claudeModel = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
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

// ─── Vision: 계기판(적산거리계) 사진에서 주행거리(km) 추출 ──
export interface OdometerOcrResult {
  odometerKm: number | null;
  confidence: 'high' | 'medium' | 'low';
  rawText: string;
}

/**
 * 차량 계기판 사진(base64)에서 적산거리(총 주행거리, km)를 OCR로 추출한다.
 * Claude Opus 4.8 비전 모델 사용. ANTHROPIC_API_KEY 미설정 시 예외.
 */
export async function extractOdometerFromImage(
  imageBase64: string,
  mediaType: string,
): Promise<OdometerOcrResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY. 적산거리 추출(OCR)을 사용할 수 없습니다.');

  const f: any = (globalThis as any).fetch;
  if (!f) throw new Error('Server fetch not available.');

  const claudeModel = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
  // Anthropic은 image/jpeg|png|gif|webp 만 허용. 그 외는 jpeg로 가정.
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const mt = allowed.includes((mediaType || '').toLowerCase()) ? mediaType.toLowerCase() : 'image/jpeg';

  const system =
    '당신은 차량 계기판 사진에서 적산거리(odometer, 총 누적 주행거리)를 읽어내는 OCR 보조원입니다. ' +
    '단위는 km이며 정수입니다. 트립미터(TRIP A/B, 구간거리)가 아닌 총 적산거리(ODO)를 읽어야 합니다. ' +
    '숫자를 명확히 읽을 수 없으면 odometerKm 을 null 로 두세요. 반드시 JSON 도구로만 답하세요.';

  const body: any = {
    model: claudeModel,
    max_tokens: 1024,
    temperature: 0,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mt, data: imageBase64 } },
          {
            type: 'text',
            text: '이 계기판 사진에서 총 적산거리(km)를 읽어 JSON으로 보고하세요.',
          },
        ],
      },
    ],
    tools: [
      {
        name: 'report_odometer',
        description: '계기판에서 읽은 적산거리(km)를 보고',
        input_schema: {
          type: 'object',
          properties: {
            odometerKm: { type: ['integer', 'null'], description: '총 적산거리(km), 읽을 수 없으면 null' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            rawText: { type: 'string', description: '사진에서 읽은 숫자 원문' },
          },
          required: ['odometerKm', 'confidence', 'rawText'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'report_odometer' },
  };

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
    throw new Error(`Claude vision error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const blocks: any[] = data?.content || [];
  const tool = blocks.find((b: any) => b.type === 'tool_use');
  const input = tool?.input || {};
  let odo = input.odometerKm;
  if (typeof odo === 'string') {
    const n = parseInt(String(odo).replace(/[^0-9]/g, ''), 10);
    odo = Number.isFinite(n) ? n : null;
  }
  if (typeof odo !== 'number' || !Number.isFinite(odo)) odo = null;
  return {
    odometerKm: odo,
    confidence: ['high', 'medium', 'low'].includes(input.confidence) ? input.confidence : 'low',
    rawText: String(input.rawText || ''),
  };
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
