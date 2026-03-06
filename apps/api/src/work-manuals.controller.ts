import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class CreateWorkManualDto {
  @IsString() @IsNotEmpty()
  userId!: string;

  @IsString() @IsNotEmpty()
  title!: string;

  @IsOptional() @IsString()
  content?: string;
}

class UpdateWorkManualDto {
  @IsString() @IsNotEmpty()
  userId!: string;

  @IsString() @IsNotEmpty()
  title!: string;

  @IsOptional() @IsString()
  content?: string;
}

class AiBpmnDto {
  @IsString() @IsNotEmpty()
  userId!: string;
}

@Controller('work-manuals')
export class WorkManualsController {
  constructor(private prisma: PrismaService) {}

  private async requireUser(userId: string) {
    const id = String(userId || '').trim();
    if (!id) throw new BadRequestException('userId required');
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new BadRequestException('invalid userId');
    return u;
  }

  private async requireOwner(userId: string, manualId: string) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const mid = String(manualId || '').trim();
    if (!mid) throw new BadRequestException('id required');
    const m = await (this.prisma as any).workManual.findUnique({ where: { id: mid } });
    if (!m) throw new BadRequestException('manual not found');
    if (String(m.userId) !== uid) throw new ForbiddenException('not allowed');
    return m as any;
  }

  @Get()
  async list(@Query('userId') userId?: string) {
    const uid = String(userId || '').trim();
    await this.requireUser(uid);
    const items = await (this.prisma as any).workManual.findMany({
      where: { userId: uid },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    return {
      items: (items || []).map((it: any) => ({
        id: it.id,
        userId: it.userId,
        title: it.title,
        content: it.content,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
      })),
    };
  }

  @Post()
  async create(@Body() dto: CreateWorkManualDto) {
    const uid = String(dto.userId || '').trim();
    await this.requireUser(uid);
    const title = String(dto.title || '').trim();
    if (!title) throw new BadRequestException('title required');
    const content = dto.content != null ? String(dto.content) : undefined;
    const created = await (this.prisma as any).workManual.create({
      data: { userId: uid, title, content },
    });
    return created;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateWorkManualDto) {
    const uid = String(dto.userId || '').trim();
    await this.requireOwner(uid, id);
    const title = String(dto.title || '').trim();
    if (!title) throw new BadRequestException('title required');
    const content = dto.content != null ? String(dto.content) : undefined;
    return (this.prisma as any).workManual.update({
      where: { id: String(id) },
      data: { title, content },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('userId') userId?: string) {
    const uid = String(userId || '').trim();
    await this.requireOwner(uid, id);
    await (this.prisma as any).workManual.delete({ where: { id: String(id) } });
    return { ok: true };
  }

  @Post(':id/ai/bpmn')
  async aiBpmn(@Param('id') id: string, @Body() dto: AiBpmnDto) {
    const uid = String(dto.userId || '').trim();
    const manual = await this.requireOwner(uid, id);

    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_CAMS || process.env.OPENAI_API_KEY_IAT;
    if (!apiKey) {
      throw new BadRequestException('Missing OPENAI_API_KEY (or *_CAMS / *_IAT). Set it as a Railway env var.');
    }

    const title = String(manual?.title || '').trim();
    const content = String(manual?.content || '').trim();
    if (!title) throw new BadRequestException('manual title missing');
    if (!content) throw new BadRequestException('manual content required');

    const clipped = content.length > 12000 ? content.slice(0, 12000) : content;

    const sys = '당신은 업무 메뉴얼을 읽고 BPMN 초안(JSON)만 출력하는 도우미입니다. 반드시 JSON만 출력하세요. 마크다운 코드펜스(``` )를 사용하지 마세요.\n\n출력 JSON 스키마:\n{\n  "title": string,\n  "bpmnJson": {\n    "nodes": Array<{ id: string, type: "start"|"end"|"task"|"gateway_xor"|"gateway_parallel", name: string, taskType?: "TASK"|"WORKLOG"|"COOPERATION"|"APPROVAL", description?: string }>,\n    "edges": Array<{ id: string, source: string, target: string, condition?: string }>\n  }\n}\n\n규칙:\n- nodes에는 start와 end를 반드시 포함\n- type=task 노드만 실제 업무 단계\n- 기본은 순차 흐름으로 만들고, 조건 분기가 명확하면 gateway_xor와 edge.condition을 사용\n- 최대 20개의 task 노드까지만 생성\n- 입력에 없는 단계는 새로 만들어내지 마세요.';

    const user = `업무명: ${title}\n\n[업무 메뉴얼]\n${clipped}`;

    const f: any = (globalThis as any).fetch;
    if (!f) {
      throw new BadRequestException('Server fetch not available. Please use Node 18+ or provide a fetch polyfill.');
    }

    const resp = await f('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new BadRequestException(`OpenAI error: ${resp.status} ${text}`);
    }

    const data = await resp.json();
    const raw = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!raw) throw new BadRequestException('OpenAI returned empty response');

    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('OpenAI did not return valid JSON');
    }

    const outTitle = String(parsed?.title || `${title} 프로세스`).trim() || `${title} 프로세스`;
    const bpmnJson = parsed?.bpmnJson;
    const nodes = Array.isArray(bpmnJson?.nodes) ? bpmnJson.nodes : null;
    const edges = Array.isArray(bpmnJson?.edges) ? bpmnJson.edges : null;
    if (!nodes || !edges) throw new BadRequestException('OpenAI JSON missing bpmnJson.nodes/edges');

    return { title: outTitle, bpmnJson };
  }
}
