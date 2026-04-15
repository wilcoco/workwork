import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Body,
  Param,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('api/company-data')
export class CompanyDataController {
  constructor(private prisma: PrismaService) {}

  // ─── CRUD ──────────────────────────────────────────────

  @Get()
  async list() {
    return this.prisma.companyData.findMany({
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  @Post()
  async create(@Body() body: { title: string; description?: string; fileUrl: string; fileName: string; content?: string; uploadedById: string }) {
    if (!body.title || !body.fileUrl || !body.uploadedById) {
      throw new BadRequestException('title, fileUrl, uploadedById required');
    }
    return this.prisma.companyData.create({
      data: {
        title: body.title,
        description: body.description || null,
        fileUrl: body.fileUrl,
        fileName: body.fileName || body.title,
        content: body.content || null,
        uploadedById: body.uploadedById,
      },
    });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const data: any = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.content !== undefined) data.content = body.content;
    if (body.fileUrl !== undefined) data.fileUrl = body.fileUrl;
    if (body.fileName !== undefined) data.fileName = body.fileName;
    return this.prisma.companyData.update({ where: { id }, data });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.companyData.delete({ where: { id } });
    return { ok: true };
  }

  // ─── AI Q&A ────────────────────────────────────────────

  @Post('ask')
  async ask(@Body() body: { question: string; dataIds?: string[]; userId: string }) {
    if (!body.question?.trim()) throw new BadRequestException('question required');
    if (!body.userId) throw new BadRequestException('userId required');

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
    if (!apiKey) throw new BadRequestException('Missing OPENAI_API_KEY');

    // Load selected data sources (or all if none specified)
    const where: any = body.dataIds?.length ? { id: { in: body.dataIds } } : {};
    const dataSources = await this.prisma.companyData.findMany({
      where,
      select: { id: true, title: true, content: true, fileName: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (!dataSources.length) {
      throw new BadRequestException('참조할 데이터가 없습니다. 먼저 자료를 등록하세요.');
    }

    // Build context from data sources
    const context = dataSources
      .filter((d) => d.content?.trim())
      .map((d, i) => `[자료 ${i + 1}: ${d.title}]\n${d.content}`)
      .join('\n\n---\n\n');

    if (!context.trim()) {
      throw new BadRequestException('등록된 자료에 추출된 내용이 없습니다. 자료의 내용을 입력해주세요.');
    }

    const systemPrompt = `당신은 회사의 통계 및 경영 데이터를 분석하는 전문가입니다.
아래 제공된 회사 자료를 바탕으로 사용자의 질문에 정확하고 구체적으로 답변하세요.
- 자료에 없는 내용은 추측하지 마세요. "제공된 자료에는 해당 정보가 없습니다"라고 답하세요.
- 숫자나 통계를 인용할 때는 정확한 값을 사용하세요.
- 가능하면 표 형태로 비교/정리해주세요.
- 한국어로 답변하세요.`;

    const userPrompt = `## 회사 자료\n\n${context}\n\n## 질문\n${body.question}`;

    // Call OpenAI (text response, not JSON)
    const f: any = (globalThis as any).fetch;
    const resp = await f('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new BadRequestException(`AI 호출 실패: ${resp.status} ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    const answer = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!answer) throw new BadRequestException('AI가 빈 응답을 반환했습니다.');

    // Save chat history
    const chat = await this.prisma.companyDataChat.create({
      data: {
        question: body.question,
        answer,
        dataIds: dataSources.map((d) => d.id),
        userId: body.userId,
      },
    });

    return { answer, chatId: chat.id };
  }

  // ─── Chat History ──────────────────────────────────────

  @Get('chats')
  async chatHistory(@Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId required');
    return this.prisma.companyDataChat.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
