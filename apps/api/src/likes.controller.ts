import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Generic Like (heart) reactions on any subject (Worklog, etc.).
 *
 * - POST /api/likes/toggle  body { subjectType, subjectId, userId }
 *     Toggles the user's like on the subject. Returns { liked, count }.
 *
 * - GET  /api/likes?subjectType=&subjectId=[&viewerId=]
 *     Returns { count, liked, likers: [{ userId, name, createdAt }] }.
 *
 * - POST /api/likes/by-subjects body { subjectType, ids[], viewerId? }
 *     Batch summary for many subjects (used on the home feed).
 *     Returns { items: { [id]: { count, liked } } }.
 */
@Controller('likes')
export class LikesController {
  constructor(private prisma: PrismaService) {}

  @Post('toggle')
  async toggle(@Body() body: { subjectType?: string; subjectId?: string; userId?: string }) {
    const subjectType = String(body?.subjectType || '').trim();
    const subjectId = String(body?.subjectId || '').trim();
    const userId = String(body?.userId || '').trim();
    if (!subjectType || !subjectId || !userId) {
      throw new BadRequestException('subjectType, subjectId, userId are required');
    }
    const existing = await (this.prisma as any).like.findUnique({
      where: { subjectType_subjectId_userId: { subjectType, subjectId, userId } },
    });
    if (existing) {
      await (this.prisma as any).like.delete({ where: { id: existing.id } });
    } else {
      await (this.prisma as any).like.create({ data: { subjectType, subjectId, userId } });
    }
    const count = await (this.prisma as any).like.count({ where: { subjectType, subjectId } });
    return { liked: !existing, count };
  }

  @Get()
  async list(
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
    @Query('viewerId') viewerId?: string,
  ) {
    const st = String(subjectType || '').trim();
    const sid = String(subjectId || '').trim();
    if (!st || !sid) throw new BadRequestException('subjectType and subjectId are required');
    const rows = await (this.prisma as any).like.findMany({
      where: { subjectType: st, subjectId: sid },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    });
    const likers = rows.map((r: any) => ({
      userId: r.userId,
      name: r.user?.name || '',
      createdAt: r.createdAt,
    }));
    const count = likers.length;
    const liked = viewerId ? likers.some((l: any) => l.userId === viewerId) : false;
    return { count, liked, likers };
  }

  @Post('by-subjects')
  async bySubjects(@Body() body: { subjectType?: string; ids?: string[]; viewerId?: string }) {
    const subjectType = String(body?.subjectType || '').trim();
    const ids = Array.isArray(body?.ids) ? body!.ids!.filter((x) => typeof x === 'string' && x.trim()) : [];
    const viewerId = body?.viewerId ? String(body.viewerId) : '';
    if (!subjectType || ids.length === 0) return { items: {} };
    const rows = await (this.prisma as any).like.findMany({
      where: { subjectType, subjectId: { in: ids } },
      select: { subjectId: true, userId: true },
    });
    const items: Record<string, { count: number; liked: boolean }> = {};
    for (const id of ids) items[id] = { count: 0, liked: false };
    for (const r of rows) {
      const cur = items[r.subjectId] || (items[r.subjectId] = { count: 0, liked: false });
      cur.count += 1;
      if (viewerId && r.userId === viewerId) cur.liked = true;
    }
    return { items };
  }
}
