import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/**
 * Computes the next run Date given the current time and schedule config.
 *
 * recurrenceType: 'DAILY' | 'WEEKLY' | 'MONTHLY'
 * recurrenceDetail (JSON string):
 *   DAILY:   { "hour": 9 }
 *   WEEKLY:  { "dayOfWeek": 1, "hour": 9 }   (0=Sun 1=Mon ... 6=Sat)
 *   MONTHLY: { "dayOfMonth": 1, "hour": 9 }
 */
function computeNextRun(
  type: string,
  detailJson: string | null | undefined,
  from: Date,
): Date | null {
  let detail: any = {};
  try { detail = JSON.parse(detailJson || '{}'); } catch {}

  const hour = typeof detail.hour === 'number' ? detail.hour : 9;
  const t = type.toUpperCase();

  if (t === 'DAILY') {
    const next = new Date(from);
    next.setHours(hour, 0, 0, 0);
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  if (t === 'WEEKLY') {
    const dow = typeof detail.dayOfWeek === 'number' ? detail.dayOfWeek : 1;
    const next = new Date(from);
    next.setHours(hour, 0, 0, 0);
    const diff = (dow - next.getDay() + 7) % 7 || 7;
    next.setDate(next.getDate() + diff);
    return next;
  }

  if (t === 'MONTHLY') {
    const dom = typeof detail.dayOfMonth === 'number' ? detail.dayOfMonth : 1;
    const next = new Date(from);
    next.setDate(dom);
    next.setHours(hour, 0, 0, 0);
    if (next <= from) {
      next.setMonth(next.getMonth() + 1);
      next.setDate(dom);
    }
    return next;
  }

  return null;
}

@Injectable()
export class ProcessSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    void this.runScheduled();
    this.timer = setInterval(() => void this.runScheduled(), this.INTERVAL_MS);
    this.logger.log(`Process scheduler started (interval: ${this.INTERVAL_MS / 1000}s)`);
  }

  onModuleDestroy() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async runScheduled() {
    const now = new Date();
    try {
      const due = await (this.prisma as any).processTemplate.findMany({
        where: {
          scheduleEnabled: true,
          status: 'ACTIVE',
          scheduleNextRunAt: { lte: now },
        },
        include: { tasks: { orderBy: { orderHint: 'asc' } } },
      });

      for (const tmpl of due) {
        try {
          await this.startInstance(tmpl, now);
        } catch (e: any) {
          this.logger.error(`Failed to auto-start template ${tmpl.id}: ${e?.message}`);
        }
      }
    } catch (e: any) {
      this.logger.error(`Scheduler check failed: ${e?.message}`);
    }
  }

  private async startInstance(tmpl: any, now: Date) {
    const title = `[자동] ${tmpl.title} — ${now.toLocaleDateString('ko-KR')}`;
    const startedById = tmpl.ownerId;

    const expectedEndAt = tmpl.expectedDurationDays
      ? addDays(now, Number(tmpl.expectedDurationDays))
      : null;

    await this.prisma.$transaction(async (tx: any) => {
      const inst = await tx.processInstance.create({
        data: {
          templateId: tmpl.id,
          title,
          startedById,
          status: 'ACTIVE',
          startAt: now,
          expectedEndAt: expectedEndAt ?? undefined,
        },
      });

      const predecessorMap = new Map<string, string>();

      for (const t of (tmpl.tasks || [])) {
        const isFirst = !t.predecessorIds;
        const status = isFirst ? 'READY' : 'CHAIN_WAIT';
        const created = await tx.processTaskInstance.create({
          data: {
            instanceId: inst.id,
            taskTemplateId: t.id,
            name: t.name,
            stageLabel: t.stageLabel || null,
            taskType: t.taskType,
            status,
            assigneeId: t.assigneeId || null,
            deadlineAt: tmpl.expectedDurationDays && t.deadlineOffsetDays != null
              ? addDays(now, Number(t.deadlineOffsetDays))
              : null,
          },
        });
        predecessorMap.set(String(t.id), created.id);
      }

      // Notify owner
      await tx.notification.create({
        data: {
          userId: startedById,
          type: 'ProcessAutoStarted',
          subjectType: 'PROCESS',
          subjectId: inst.id,
          payload: { title, templateId: tmpl.id },
        },
      });
    });

    // Update schedule timestamps
    const nextRun = computeNextRun(
      tmpl.recurrenceType || '',
      tmpl.recurrenceDetail,
      now,
    );
    await (this.prisma as any).processTemplate.update({
      where: { id: tmpl.id },
      data: {
        scheduleLastRunAt: now,
        scheduleNextRunAt: nextRun ?? undefined,
      },
    });

    this.logger.log(`Auto-started process "${title}" from template ${tmpl.id}, next run: ${nextRun?.toISOString() ?? 'none'}`);
  }
}
