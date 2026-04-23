import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from './prisma.service';

class UpsertWeeklyReportDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsString() @IsNotEmpty() weekStart!: string;
  @IsOptional() sections?: any;
  @IsOptional() @IsString() status?: 'DRAFT' | 'CONFIRMED';
}

@Controller('weekly-reports')
export class WeeklyReportsController {
  constructor(private prisma: PrismaService) {}

  /** 주간 리포트 목록 조회 (팀 또는 개인) */
  @Get()
  async list(
    @Query('userId') userId?: string,
    @Query('orgUnitId') orgUnitId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = Math.min(parseInt(limitStr || '20', 10) || 20, 100);
    const where: any = {};
    if (userId) where.userId = userId;
    if (orgUnitId) where.orgUnitId = orgUnitId;
    if (from || to) {
      where.weekStart = {};
      if (from) where.weekStart.gte = new Date(from);
      if (to) where.weekStart.lte = new Date(to);
    }
    const items = await (this.prisma as any).weeklyReport.findMany({
      where,
      take: limit,
      orderBy: { weekStart: 'desc' },
      include: { user: { select: { id: true, name: true, role: true } }, orgUnit: { select: { id: true, name: true } } },
    });
    return { items };
  }

  /** 특정 주간 리포트 조회 */
  @Get(':id')
  async get(@Param('id') id: string) {
    const report = await (this.prisma as any).weeklyReport.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, role: true } }, orgUnit: { select: { id: true, name: true } } },
    });
    if (!report) throw new BadRequestException('Weekly report not found');
    return report;
  }

  /** 주간 리포트 생성/업데이트 (upsert) */
  @Post()
  async upsert(@Body() dto: UpsertWeeklyReportDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId }, include: { orgUnit: true } });
    if (!user) throw new BadRequestException('User not found');

    const weekStart = new Date(dto.weekStart);
    if (isNaN(weekStart.getTime())) throw new BadRequestException('Invalid weekStart date');

    const report = await (this.prisma as any).weeklyReport.upsert({
      where: { userId_weekStart: { userId: user.id, weekStart } },
      create: {
        userId: user.id,
        orgUnitId: user.orgUnitId || undefined,
        weekStart,
        sections: dto.sections ?? null,
        status: (dto.status as any) ?? 'DRAFT',
      },
      update: {
        sections: dto.sections ?? undefined,
        status: (dto.status as any) ?? undefined,
      },
    });
    return report;
  }

  /** AI로 주간 업무일지를 자동 집계하여 5개 섹션 생성 */
  @Post('ai-generate')
  async aiGenerate(@Body() body: { userId: string; weekStart: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: body.userId }, include: { orgUnit: true } });
    if (!user) throw new BadRequestException('User not found');

    const weekStart = new Date(body.weekStart);
    if (isNaN(weekStart.getTime())) throw new BadRequestException('Invalid weekStart date');
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Fetch all worklogs for this user in the given week
    const worklogs = await this.prisma.worklog.findMany({
      where: {
        createdById: user.id,
        date: { gte: weekStart, lt: weekEnd },
      },
      orderBy: { date: 'asc' },
      include: { initiative: true },
    });

    if (!worklogs.length) {
      return { sections: null, message: '해당 주에 작성된 업무일지가 없습니다.' };
    }

    // Build summary text from worklogs
    const logTexts = worklogs.map((wl: any, i: number) => {
      const dateStr = wl.date ? new Date(wl.date).toISOString().slice(0, 10) : '';
      const task = wl.initiative?.title || '';
      const note = String(wl.note || '').slice(0, 500);
      const sd = wl.structuredData;
      let structured = '';
      if (sd) {
        if (Array.isArray(sd.todayTasks)) {
          structured += sd.todayTasks.map((t: any) => `[${t.status === 'completed' ? '완료' : t.status === 'in_progress' ? '진행' : '대기'}] ${t.name}: ${t.detail || ''}`).join('\n');
        }
        if (Array.isArray(sd.issues) && sd.issues.length) {
          structured += '\n이슈: ' + sd.issues.map((t: any) => `${t.problem}`).join(', ');
        }
      }
      return `[${i + 1}] ${dateStr} | ${task}\n${structured || note}`;
    }).join('\n\n');

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // Fallback: generate simple aggregation without AI
      return { sections: this.buildFallbackSections(worklogs), message: 'AI 키 없음 - 기본 집계' };
    }

    const systemPrompt = `당신은 제조업 팀장을 위한 주간 업무 리포트 작성 도우미입니다.
주어진 일일 업무일지들을 분석하여 아래 5개 섹션의 주간 리포트를 JSON으로 생성하세요.

출력 JSON 형식:
{
  "completedTasks": ["이번 주 완료된 주요 업무 목록"],
  "ongoingProjects": ["진행 중인 핵심 프로젝트/업무"],
  "risksAndIssues": ["문제점, 리스크, 장애물"],
  "nextWeekPlan": ["다음 주 계획"],
  "supportRequests": ["지원 요청 사항"]
}

각 항목은 간결하고 구체적으로 작성하세요. 빈 섹션은 빈 배열로 두세요.`;

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4.1',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `다음은 ${user.name}님의 이번 주(${body.weekStart}) 업무일지입니다:\n\n${logTexts}` },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: 2000,
        }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || '{}';
      const sections = JSON.parse(content);
      return { sections };
    } catch (err: any) {
      return { sections: this.buildFallbackSections(worklogs), message: 'AI 호출 실패 - 기본 집계', error: err?.message };
    }
  }

  private buildFallbackSections(worklogs: any[]): any {
    const completed: string[] = [];
    const ongoing: string[] = [];
    const issues: string[] = [];

    for (const wl of worklogs) {
      const task = wl.initiative?.title || '';
      const sd = wl.structuredData;
      if (sd) {
        if (Array.isArray(sd.todayTasks)) {
          for (const t of sd.todayTasks) {
            if (t.status === 'completed' && t.name) completed.push(t.name);
            else if (t.name) ongoing.push(t.name);
          }
        }
        if (Array.isArray(sd.issues)) {
          for (const t of sd.issues) {
            if (t.problem) issues.push(t.problem);
          }
        }
      } else if (task) {
        ongoing.push(task);
      }
    }

    return {
      completedTasks: [...new Set(completed)],
      ongoingProjects: [...new Set(ongoing)],
      risksAndIssues: [...new Set(issues)],
      nextWeekPlan: [],
      supportRequests: [],
    };
  }
}
