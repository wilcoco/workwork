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

    // Transcribe each chunk via Whisper API
    const transcriptParts: string[] = [];
    for (const chunk of chunks) {
      const upload = await this.prisma.upload.findUnique({ where: { id: chunk.uploadId } });
      if (!upload || !upload.data) continue;

      const blob = new Blob([Buffer.from(upload.data as any)], { type: upload.contentType || 'audio/webm' });
      const formData = new FormData();
      formData.append('file', blob, upload.originalName || 'audio.webm');
      formData.append('model', 'whisper-1');
      formData.append('language', 'ko');
      formData.append('response_format', 'text');

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
        const text = await resp.text();
        transcriptParts.push(text.trim());
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

  // ─── AI Summary ────────────────────────────────────────────

  @Post(':id/summarize')
  async summarize(@Param('id') id: string) {
    const meeting = await this.prisma.meetingMinutes.findUnique({ where: { id } });
    if (!meeting) throw new BadRequestException('Meeting not found');
    if (!meeting.transcript) throw new BadRequestException('No transcript to summarize');

    const { callAI } = await import('./llm/ai-client');

    const system = `당신은 회의록 정리 전문가입니다. 회의 녹취록을 분석하여 체계적인 요약을 작성합니다.
반드시 JSON으로 응답하세요.`;

    const user = `다음 회의 녹취록을 분석하여 요약해주세요.

회의 제목: ${meeting.title}
회의 일시: ${meeting.date ? new Date(meeting.date).toLocaleString('ko-KR') : '미정'}

녹취록:
${meeting.transcript}

다음 JSON 형식으로 응답하세요:
{
  "summary": "회의 전체 요약 (3-5문장)",
  "keyPoints": ["핵심 논의 사항 1", "핵심 논의 사항 2", ...],
  "decisions": ["결정 사항 1", "결정 사항 2", ...],
  "actionItems": [
    { "text": "할 일 내용", "assignee": "담당자 (있으면)", "dueDate": "기한 (있으면)" }
  ],
  "nextSteps": "후속 조치 요약"
}`;

    const result = await callAI({ system, user, model: 'openai', maxTokens: 4096 });

    const parsed = result.parsed || {};
    const summaryText = [
      parsed.summary || '',
      parsed.keyPoints?.length ? `\n\n**핵심 논의 사항:**\n${parsed.keyPoints.map((p: string) => `- ${p}`).join('\n')}` : '',
      parsed.decisions?.length ? `\n\n**결정 사항:**\n${parsed.decisions.map((d: string) => `- ${d}`).join('\n')}` : '',
      parsed.nextSteps ? `\n\n**후속 조치:** ${parsed.nextSteps}` : '',
    ].filter(Boolean).join('');

    await this.prisma.meetingMinutes.update({
      where: { id },
      data: {
        summary: summaryText,
        actionItems: parsed.actionItems || [],
        status: 'summarized',
      },
    });

    return { summary: summaryText, actionItems: parsed.actionItems || [] };
  }
}
