import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import { PrismaService } from './prisma.service';
import { IsOptional, IsString, IsNotEmpty, IsArray, IsDateString } from 'class-validator';

class CreateMeetingDto {
  @IsString() @IsNotEmpty() title!: string;
  @IsString() @IsNotEmpty() createdById!: string;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsArray() participants?: string[];
}

class UpdateMeetingDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsArray() participants?: string[];
  @IsOptional() @IsString() transcript?: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() actionItems?: any;
  @IsOptional() @IsString() status?: string;
  @IsOptional() duration?: number;
  @IsOptional() attachments?: any;
}

@Controller('meeting-minutes')
export class MeetingMinutesController {
  constructor(private prisma: PrismaService) {}

  // ─── CRUD ──────────────────────────────────────────────────

  @Get()
  async list(@Query() q: { createdById?: string; status?: string; limit?: string }) {
    const where: any = {};
    if (q.createdById) where.createdById = q.createdById;
    if (q.status) where.status = q.status;
    const items = await this.prisma.meetingMinutes.findMany({
      where,
      orderBy: { date: 'desc' },
      take: Number(q.limit) || 50,
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return { items };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const m = await this.prisma.meetingMinutes.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!m) throw new BadRequestException('Meeting not found');
    return m;
  }

  @Post()
  async create(@Body() dto: CreateMeetingDto) {
    const m = await this.prisma.meetingMinutes.create({
      data: {
        title: dto.title,
        createdById: dto.createdById,
        date: dto.date ? new Date(dto.date) : new Date(),
        participants: dto.participants || [],
        status: 'draft',
      },
    });
    return m;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateMeetingDto) {
    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.participants !== undefined) data.participants = dto.participants;
    if (dto.transcript !== undefined) data.transcript = dto.transcript;
    if (dto.summary !== undefined) data.summary = dto.summary;
    if (dto.actionItems !== undefined) data.actionItems = dto.actionItems;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.duration !== undefined) data.duration = dto.duration;
    if (dto.attachments !== undefined) data.attachments = dto.attachments;
    const m = await this.prisma.meetingMinutes.update({ where: { id }, data });
    return m;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.meetingMinutes.delete({ where: { id } });
    return { ok: true };
  }

  // ─── File Attachment Upload ──────────────────────────────────

  @Post(':id/attach')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  async uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('file is required');

    const meeting = await this.prisma.meetingMinutes.findUnique({ where: { id } });
    if (!meeting) throw new BadRequestException('Meeting not found');

    const { randomUUID } = await import('crypto');
    const { extname } = await import('path');
    const ext = extname(file.originalname || '.bin');
    const filename = `${randomUUID()}${ext}`;
    const rec = await this.prisma.upload.create({
      data: {
        filename,
        originalName: file.originalname || 'file',
        contentType: file.mimetype || 'application/octet-stream',
        size: file.size,
        data: file.buffer,
      } as any,
    });

    const url = `/api/uploads/files/${rec.id}`;
    const newAttachment = {
      url,
      name: file.originalname || filename,
      size: file.size,
      contentType: file.mimetype || 'application/octet-stream',
      uploadId: rec.id,
    };

    const existing = Array.isArray((meeting as any).attachments) ? (meeting as any).attachments : [];
    existing.push(newAttachment);
    await this.prisma.meetingMinutes.update({
      where: { id },
      data: { attachments: existing as any },
    });

    return newAttachment;
  }

  // ─── Audio Upload (chunk) ──────────────────────────────────

  @Post(':id/audio')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }))
  async uploadAudio(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { order?: string; duration?: string },
  ) {
    if (!file) throw new BadRequestException('file is required');

    // Save audio chunk to Upload table
    const { randomUUID } = await import('crypto');
    const { extname } = await import('path');
    const ext = extname(file.originalname || '.webm');
    const filename = `${randomUUID()}${ext}`;
    const rec = await this.prisma.upload.create({
      data: {
        filename,
        originalName: file.originalname || 'audio-chunk',
        contentType: file.mimetype || 'audio/webm',
        size: file.size,
        data: file.buffer,
      } as any,
    });

    // Append chunk info to meeting
    const meeting = await this.prisma.meetingMinutes.findUnique({ where: { id } });
    if (!meeting) throw new BadRequestException('Meeting not found');
    const chunks = Array.isArray((meeting as any).audioChunks) ? (meeting as any).audioChunks : [];
    chunks.push({
      uploadId: rec.id,
      order: Number(body.order) || chunks.length,
      duration: Number(body.duration) || 0,
    });
    await this.prisma.meetingMinutes.update({
      where: { id },
      data: {
        audioChunks: chunks as any,
        audioUploadId: chunks.length === 1 ? rec.id : (meeting as any).audioUploadId,
        status: 'recording',
      },
    });

    return { uploadId: rec.id, chunkIndex: chunks.length - 1 };
  }

  // ─── Transcribe ────────────────────────────────────────────

  @Post(':id/transcribe')
  async transcribe(@Param('id') id: string) {
    const meeting = await this.prisma.meetingMinutes.findUnique({ where: { id } });
    if (!meeting) throw new BadRequestException('Meeting not found');

    const chunks = Array.isArray((meeting as any).audioChunks) ? (meeting as any).audioChunks : [];
    if (!chunks.length) throw new BadRequestException('No audio chunks to transcribe');

    await this.prisma.meetingMinutes.update({ where: { id }, data: { status: 'transcribing' } });

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
    if (!apiKey) throw new BadRequestException('OpenAI API key not configured');

    const f: any = (globalThis as any).fetch;
    if (!f) throw new BadRequestException('Server fetch not available');

    // Whisper accepts an optional `prompt` that biases recognition toward
    // the vocabulary used in the prompt (works as a soft style/lexicon
    // hint). Admins can supply company-specific terms via STT_PROMPT,
    // otherwise we fall back to MEETING_GLOSSARY (which is also used by
    // the summariser). Keep it short — Whisper truncates beyond ~224
    // tokens of prompt text.
    const baseHint = String(
      process.env.STT_PROMPT || process.env.MEETING_GLOSSARY || '',
    ).trim().slice(0, 800);

    // Transcribe each chunk via Whisper API.
    // For continuity across chunks, also feed the tail of the previous
    // transcript as part of the prompt so spelling/style stays consistent.
    const transcriptParts: string[] = [];
    let prevTail = '';
    for (const chunk of chunks) {
      const upload = await this.prisma.upload.findUnique({ where: { id: chunk.uploadId } });
      if (!upload || !upload.data) continue;

      const promptParts: string[] = [];
      if (baseHint) promptParts.push(baseHint);
      if (prevTail) promptParts.push(prevTail);
      const promptText = promptParts.join('\n').slice(-1000); // hard cap

      const blob = new Blob([Buffer.from(upload.data as any)], { type: upload.contentType || 'audio/webm' });
      const formData = new FormData();
      formData.append('file', blob, upload.originalName || 'audio.webm');
      formData.append('model', 'whisper-1');
      formData.append('language', 'ko');
      formData.append('response_format', 'text');
      // Lower temperature -> Whisper sticks closer to high-confidence words
      // instead of paraphrasing unclear audio into wild guesses.
      formData.append('temperature', '0');
      if (promptText) formData.append('prompt', promptText);

      try {
        const resp = await f('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: formData,
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          console.error('[meeting-minutes] Whisper error:', resp.status, errText);
          transcriptParts.push(`[전사 실패: chunk ${chunk.order}]`);
          continue;
        }
        const text = (await resp.text()).trim();
        transcriptParts.push(text);
        // Carry tail of this chunk into the next chunk's prompt for
        // cross-chunk continuity (names, terminology, sentence flow).
        prevTail = text.slice(-300);
      } catch (err: any) {
        console.error('[meeting-minutes] Whisper exception:', err?.message);
        transcriptParts.push(`[전사 실패: chunk ${chunk.order}]`);
      }
    }

    const fullTranscript = transcriptParts.join('\n\n');
    const totalDuration = chunks.reduce((sum: number, c: any) => sum + (c.duration || 0), 0);

    await this.prisma.meetingMinutes.update({
      where: { id },
      data: {
        transcript: fullTranscript,
        duration: totalDuration || (meeting as any).duration,
        status: 'draft',
      },
    });

    return { transcript: fullTranscript, duration: totalDuration };
  }

  // ─── AI Refine (transcript clean-up) ──────────────────────

  /**
   * Run an LLM pass over the existing transcript to fix obvious STT
   * mishearings, normalise jargon spelling, and lightly clean filler /
   * punctuation. The model must NOT add new facts; only word-level edits
   * and minimal whitespace/punctuation tweaks are allowed.
   *
   * The cleaned-up text overwrites the existing transcript so the next
   * "summarize" step works from a higher-quality input. Audio chunks are
   * untouched so the user can re-run the original "AI 음성 전사" any time.
   */
  @Post(':id/refine')
  async refine(@Param('id') id: string) {
    const meeting = await this.prisma.meetingMinutes.findUnique({ where: { id } });
    if (!meeting) throw new BadRequestException('Meeting not found');
    const transcript = String(meeting.transcript || '').trim();
    if (transcript.length < 20) {
      throw new BadRequestException('정제할 녹취록이 너무 짧습니다. 먼저 AI 음성 전사를 진행하세요.');
    }

    const { callAI } = await import('./llm/ai-client');
    const glossary = String(process.env.MEETING_GLOSSARY || '').trim();

    const system = `당신은 한국어 회의 녹취록 정제 전문가입니다. 입력은 STT(음성→텍스트)로 자동 변환된 회의 녹취록입니다. 다음 원칙으로 "녹취록 자체"를 최소 침습으로 다듬어 주세요.

원칙:
- 명백한 STT 오인식 단어만 문맥·일반 업무 상식·아래 용어집을 기반으로 올바른 단어로 교체합니다.
- 의미가 모호하면 원문을 유지합니다.
- 새로운 사실/이름/숫자/일정/결정은 절대 추가하지 않습니다.
- 발화 순서·정보·뉘앙스는 유지합니다. 요약하거나 재구성하지 마세요.
- 명백한 군더더기(어, 음, 그, 그러니까 같은 필러 단어)는 가독성을 위해 제거 가능하지만 발화 흐름이 망가지면 그대로 둡니다.
- 문장 부호와 줄바꿈은 자연스럽게 다듬어도 됩니다.
- 화자 표시(예: "김부장:") 가 원문에 있으면 그대로 유지합니다.

반드시 JSON으로 응답하세요.`;

    const user = `${glossary ? `참고 용어집(STT 오인식이 잦은 회사·업무 용어):\n${glossary}\n\n` : ''}원본 녹취록:\n${transcript}\n\n다음 JSON 형식으로 응답하세요. \`refined\` 에는 정제된 전체 녹취록을, \`corrections\` 에는 실제로 바꾼 단어/표현만 적습니다(없으면 빈 배열).
{
  "refined": "정제된 녹취록 전체 텍스트",
  "corrections": [
    { "from": "원문", "to": "교정", "reason": "간단 사유" }
  ]
}`;

    // Use Claude Opus (top-tier) for transcript refinement: it handles
    // long Korean context, jargon, and minimal-edit constraints noticeably
    // better than gpt-4.1 in our testing. Falls back to OpenAI in
    // ai-client when ANTHROPIC_API_KEY is missing.
    const result = await callAI({ system, user, model: 'claude', maxTokens: 8192, temperature: 0.1 });
    const parsed: any = result.parsed || {};
    const refined = String(parsed?.refined || '').trim();
    const corrections: Array<{ from?: string; to?: string; reason?: string }> = Array.isArray(parsed?.corrections)
      ? parsed.corrections
      : [];
    if (!refined) {
      throw new BadRequestException('정제 결과를 받지 못했습니다. 다시 시도해주세요.');
    }

    await this.prisma.meetingMinutes.update({
      where: { id },
      data: { transcript: refined },
    });

    return { transcript: refined, corrections };
  }

  // ─── AI Summary ────────────────────────────────────────────

  @Post(':id/summarize')
  async summarize(@Param('id') id: string) {
    const meeting = await this.prisma.meetingMinutes.findUnique({ where: { id } });
    if (!meeting) throw new BadRequestException('Meeting not found');
    if (!meeting.transcript) throw new BadRequestException('No transcript to summarize');

    // Guard: transcript must have meaningful content (at least 20 chars)
    const transcript = String(meeting.transcript || '').trim();
    if (transcript.length < 20) {
      throw new BadRequestException('녹취록 내용이 너무 짧아 요약할 수 없습니다. 녹음 후 AI 음성 전사를 먼저 진행해주세요.');
    }

    const { callAI } = await import('./llm/ai-client');

    // Optional company-specific glossary, supplied via env so admins can
    // teach the model how STT typically misrecognises our jargon. Format
    // is freeform text (one entry per line, "잘못→올바른" or any natural
    // phrasing). Example:
    //   MEETING_GLOSSARY="캠스: CAMS / 케이엠에스 / 컴스 으로 들리면 모두 '캠스'\n
    //                     OKR: 오케알 / 오캐알 → OKR\n
    //                     이니셔티브: 이니시어티브 / 이내셔티브 → 이니셔티브"
    const glossary = String(process.env.MEETING_GLOSSARY || '').trim();

    const system = `당신은 한국어 회의록 정리 전문가입니다. 입력된 녹취록은 STT(음성→텍스트) 자동 변환물이므로 한국어 동음이의어, 영문 기술 용어, 사람·조직·고유명사가 자주 잘못 인식됩니다.

수행 절차:
1) 먼저 녹취록을 마음속으로 "교정"합니다. 문맥과 일반 업무 상식, 그리고 아래 용어집을 활용해 STT 오인식이 명백한 단어만 올바른 단어로 바꿉니다.
2) 교정된 의미를 바탕으로 요약·핵심 논의·결정 사항·액션 아이템을 작성합니다.

교정 규칙(중요):
- 명백한 STT 오인식만 교정합니다(예: 음운이 비슷하고 문맥상 의미가 분명한 경우).
- 발화자가 무엇을 말하려 했는지 모호하면 원문을 유지하고 [원문 그대로] 표기합니다.
- 새로운 사실, 인물, 결정, 일정, 숫자를 만들어내지 않습니다. 교정은 어휘 단위에 한합니다.
- 녹취록에 전혀 등장하지 않은 내용은 절대 추가하지 않습니다.
- 담당자·기한이 명시되지 않았으면 빈 문자열로 둡니다.

반드시 JSON으로 응답하세요.`;

    const user = `회의 제목: ${meeting.title}
회의 일시: ${meeting.date ? new Date(meeting.date).toLocaleString('ko-KR') : '미정'}

${glossary ? `참고 용어집(STT 오인식이 잦은 회사·업무 용어):\n${glossary}\n` : ''}
녹취록(STT 원문, 오인식 가능):
${transcript}

위 절차대로 STT 오인식만 살짝 교정한 뒤 다음 JSON 형식으로 응답하세요. \`corrections\` 에는 실제로 바꾼 항목만 적고, 바꾸지 않았으면 빈 배열로 두세요. 사실을 새로 만들지 마세요.
{
  "summary": "회의 전체 요약 (3-5문장, 교정된 의미 기반)",
  "keyPoints": ["핵심 논의 사항 1", ...],
  "decisions": ["결정 사항 1", ...],
  "actionItems": [
    { "text": "할 일", "assignee": "담당자 또는 빈값", "dueDate": "기한 또는 빈값" }
  ],
  "nextSteps": "후속 조치",
  "corrections": [
    { "from": "녹취록 원문 단어", "to": "교정한 단어", "reason": "문맥/용어집/일반 상식 등 간단 사유" }
  ]
}`;

    const result = await callAI({ system, user, model: 'openai', maxTokens: 4096 });

    const parsed = result.parsed || {};
    const corrections: Array<{ from?: string; to?: string; reason?: string }> = Array.isArray(parsed.corrections)
      ? parsed.corrections
      : [];
    const summaryText = [
      parsed.summary || '',
      parsed.keyPoints?.length ? `\n\n**핵심 논의 사항:**\n${parsed.keyPoints.map((p: string) => `- ${p}`).join('\n')}` : '',
      parsed.decisions?.length ? `\n\n**결정 사항:**\n${parsed.decisions.map((d: string) => `- ${d}`).join('\n')}` : '',
      parsed.nextSteps ? `\n\n**후속 조치:** ${parsed.nextSteps}` : '',
      corrections.length
        ? `\n\n**STT 교정 내역:**\n${corrections
            .filter((c) => c && (c.from || c.to))
            .map((c) => `- ${String(c.from || '').trim()} → ${String(c.to || '').trim()}${c.reason ? ` (${c.reason})` : ''}`)
            .join('\n')}`
        : '',
    ].filter(Boolean).join('');

    await this.prisma.meetingMinutes.update({
      where: { id },
      data: {
        summary: summaryText,
        actionItems: parsed.actionItems || [],
        status: 'summarized',
      },
    });

    return { summary: summaryText, actionItems: parsed.actionItems || [], corrections };
  }
}
