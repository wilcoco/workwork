import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('admin')
export class AdminController {
  constructor(private prisma: PrismaService) {}

  @Post('wipe')
  async wipe(@Body() body: { confirm?: string }) {
    if (!body?.confirm || body.confirm !== 'ERASE ALL') {
      throw new BadRequestException("confirm must be 'ERASE ALL'");
    }
    const summary: Record<string, number> = {};
    await this.prisma.$transaction(async (tx) => {
      // 1) Non-OKR, ancillary tables (child-first where applicable)
      summary.checklistTicks = (await tx.checklistTick.deleteMany({})).count;
      summary.checklistItems = (await tx.checklistItem.deleteMany({})).count;
      summary.worklogs = (await tx.worklog.deleteMany({})).count;
      summary.delegations = (await tx.delegation.deleteMany({})).count;
      summary.approvalSteps = (await tx.approvalStep.deleteMany({})).count;
      summary.approvalRequests = (await tx.approvalRequest.deleteMany({})).count;
      summary.shares = (await tx.share.deleteMany({})).count;
      summary.feedbacks = (await tx.feedback.deleteMany({})).count;
      summary.notifications = (await tx.notification.deleteMany({})).count;
      summary.events = (await tx.event.deleteMany({})).count;
      summary.uploads = (await tx.upload.deleteMany({})).count;
      summary.assets = (await tx.asset.deleteMany({})).count;

      // 2) OKR trees: delete via cascade routines (roots first)
      const deleteInitiativeCascade = async (id: string) => {
        const children = await tx.initiative.findMany({ where: { parentId: id }, select: { id: true } });
        for (const ch of children) await deleteInitiativeCascade(ch.id);
        const items = await tx.checklistItem.findMany({ where: { initiativeId: id }, select: { id: true } });
        if (items.length > 0) {
          await tx.checklistTick.deleteMany({ where: { checklistItemId: { in: items.map((i: any) => i.id) } } });
        }
        await tx.checklistItem.deleteMany({ where: { initiativeId: id } });
        await tx.worklog.deleteMany({ where: { initiativeId: id } });
        await tx.delegation.deleteMany({ where: { childInitiativeId: id } });
        await tx.initiative.delete({ where: { id } });
      };
      const deleteObjectiveCascade = async (id: string) => {
        const krs = await tx.keyResult.findMany({ where: { objectiveId: id }, select: { id: true } });
        for (const kr of krs) {
          // delete KR subtree
          const alignedObjs = await tx.objective.findMany({ where: ({ alignsToKrId: kr.id } as any), select: { id: true } });
          for (const o of alignedObjs) await deleteObjectiveCascade(o.id);
          const inits = await tx.initiative.findMany({ where: { keyResultId: kr.id }, select: { id: true } });
          for (const ii of inits) await deleteInitiativeCascade(ii.id);
          await tx.keyResult.delete({ where: { id: kr.id } });
        }
        // delete objective children (parent relation)
        const children = await tx.objective.findMany({ where: ({ parentId: id } as any), select: { id: true } });
        for (const ch of children) await deleteObjectiveCascade(ch.id);
        await tx.objective.delete({ where: { id } });
      };
      const roots = await tx.objective.findMany({ where: ({ alignsToKrId: null } as any), select: { id: true } });
      for (const r of roots) await deleteObjectiveCascade(r.id);

      // safety cleanup (should be zero)
      summary.initiatives = (await tx.initiative.deleteMany({})).count;
      summary.keyResults = (await tx.keyResult.deleteMany({})).count;
      summary.objectives = (await tx.objective.deleteMany({})).count;

      // 3) Goals
      summary.userGoals = (await (tx as any).userGoal.deleteMany({})).count;

      // 4) Users (unlink then delete)
      await tx.user.updateMany({ data: { orgUnitId: null } });
      summary.users = (await tx.user.deleteMany({})).count;

      // 5) Org Units bottom-up
      // Loop delete leaves until empty
      while (true) {
        const leaves = await tx.orgUnit.findMany({ where: { children: { none: {} } }, select: { id: true } });
        if (leaves.length === 0) break;
        const ids = leaves.map((x: any) => x.id);
        const res = await tx.orgUnit.deleteMany({ where: { id: { in: ids } } });
        summary.orgUnits = (summary.orgUnits || 0) + res.count;
      }
    });
    return { ok: true, summary };
  }
}
