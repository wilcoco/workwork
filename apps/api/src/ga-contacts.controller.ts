import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** 총무 비상연락망 — 조회는 전 구성원, 수정은 임원 이상 */
@Controller('ga-contacts')
export class GaContactsController {
  constructor(private prisma: PrismaService) {}

  private async assertExec(uid?: string) {
    const id = String(uid || '').trim();
    if (!id) throw new BadRequestException('actorId required');
    const u = await (this.prisma as any).user.findUnique({ where: { id }, select: { role: true } });
    if (!['CEO', 'EXEC'].includes(String(u?.role || '').toUpperCase())) {
      throw new ForbiddenException('임원 이상만 수정할 수 있습니다');
    }
  }

  @Get()
  async list(@Query('q') q?: string) {
    const term = String(q || '').trim();
    const where = term
      ? { OR: ['category', 'task', 'deptName', 'managerName', 'phone', 'vendorName', 'vendorPhone', 'note'].map((f) => ({ [f]: { contains: term, mode: 'insensitive' as any } })) }
      : {};
    const items = await (this.prisma as any).gaContact.findMany({ where, orderBy: [{ orderHint: 'asc' }, { createdAt: 'asc' }] });
    return { items };
  }

  @Post()
  async create(@Body() body: any) {
    await this.assertExec(body?.actorId);
    if (!String(body?.category || '').trim() || !String(body?.task || '').trim()) {
      throw new BadRequestException('구분과 내용은 필수입니다');
    }
    const max = await (this.prisma as any).gaContact.aggregate({ _max: { orderHint: true } });
    return (this.prisma as any).gaContact.create({
      data: {
        category: String(body.category).trim(),
        task: String(body.task).trim(),
        deptName: String(body.deptName || '').trim(),
        managerName: String(body.managerName || '').trim(),
        phone: String(body.phone || '').trim(),
        vendorName: String(body.vendorName || '').trim(),
        vendorPhone: String(body.vendorPhone || '').trim(),
        note: String(body.note || '').trim(),
        orderHint: (max._max.orderHint ?? 0) + 1,
      },
    });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    await this.assertExec(body?.actorId);
    const data: any = {};
    for (const f of ['category', 'task', 'deptName', 'managerName', 'phone', 'vendorName', 'vendorPhone', 'note']) {
      if (body[f] !== undefined) data[f] = String(body[f]).trim();
    }
    return (this.prisma as any).gaContact.update({ where: { id }, data });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('actorId') actorId?: string) {
    await this.assertExec(actorId);
    await (this.prisma as any).gaContact.delete({ where: { id } });
    return { ok: true };
  }
}
