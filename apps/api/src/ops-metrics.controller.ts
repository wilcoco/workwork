import { BadRequestException, Controller, ForbiddenException, Get, Post, Query, Body } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { GRADE_LABEL, OpsMetricsService } from './ops-metrics.service';

/** 온톨로지 완성도·운영 계기판 API (임원 이상) */
@Controller('ops-metrics')
export class OpsMetricsController {
  constructor(private prisma: PrismaService, private svc: OpsMetricsService) {}

  private async assertExec(userId?: string) {
    const uid = String(userId || '').trim();
    if (!uid) throw new BadRequestException('userId required');
    const u = await this.prisma.user.findUnique({ where: { id: uid }, select: { role: true } });
    if (!u || !['CEO', 'EXEC'].includes(String(u.role).toUpperCase())) throw new ForbiddenException('임원 이상만 볼 수 있습니다');
  }

  /** 현재값(실시간 계산) + 90일 이력 */
  @Get('maturity')
  async maturity(@Query('userId') userId?: string) {
    await this.assertExec(userId);
    const [cur, hist] = await Promise.all([this.svc.compute(), this.svc.history(90)]);
    // 다음 등급까지 가장 효과 큰 조치: 가중치 × (100 − 점수) 큰 순
    const nextThreshold = cur.grade >= 4 ? null : [40, 60, 80][cur.grade - 1];
    const levers = cur.components.map((c) => ({ key: c.key, label: c.label, potential: Math.round(((100 - c.score) * c.weight) / 100 * 10) / 10, score: c.score, weight: c.weight, hint: c.hint })).sort((a, b) => b.potential - a.potential).slice(0, 4);
    return { ...cur, gradeLabel: GRADE_LABEL[cur.grade], nextThreshold, gradeLabels: GRADE_LABEL, levers, history: hist.reverse() };
  }

  /** 오늘 스냅샷 강제 생성(임원) — 계기판 "지금 기록" 버튼 */
  @Post('snapshot')
  async snapshot(@Body() b: any) {
    await this.assertExec(b?.userId);
    const date = this.svc.kstDate();
    const r = await this.svc.compute();
    await (this.prisma as any).opsMetricDaily.upsert({ where: { date }, create: { date, score: r.score, grade: r.grade, components: r.components }, update: { score: r.score, grade: r.grade, components: r.components, computedAt: new Date() } });
    return { date, score: r.score, grade: r.grade };
  }
}
