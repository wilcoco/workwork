import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('admin')
export class AdminController {
  constructor(private prisma: PrismaService) {}

  private async assertCeo(userId?: string) {
    if (!userId) throw new BadRequestException('userId required');
    const actor = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!actor || (actor.role as any) !== 'CEO') throw new ForbiddenException('only CEO can perform this action');
  }

  @Post('wipe')
  async wipe(@Body() body: { confirm?: string }, @Query('userId') userId?: string) {
    await this.assertCeo(userId);
    if (!body?.confirm || body.confirm !== 'ERASE ALL') {
      throw new BadRequestException("confirm must be 'ERASE ALL'");
    }
    const summary: Record<string, number> = {};
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
      // 1) Non-OKR, ancillary tables (child-first where applicable)
      summary.progressEntries = (await (tx as any).progressEntry.deleteMany({})).count;
      summary.processStopEvents = (await (tx as any).processStopEvent.deleteMany({})).count;
      summary.processTaskInstances = (await (tx as any).processTaskInstance.deleteMany({})).count;
      summary.processInstances = (await (tx as any).processInstance.deleteMany({})).count;
      summary.processTaskTemplates = (await (tx as any).processTaskTemplate.deleteMany({})).count;
      summary.processTemplates = (await (tx as any).processTemplate.deleteMany({})).count;
      summary.helpTickets = (await (tx as any).helpTicket.deleteMany({})).count;
      summary.carDispatchRequests = (await (tx as any).carDispatchRequest.deleteMany({})).count;
      summary.attendanceRequests = (await (tx as any).attendanceRequest.deleteMany({})).count;
      summary.keyResultAssignments = (await (tx as any).keyResultAssignment.deleteMany({})).count;
      summary.checklistTicks = (await (tx as any).checklistTick.deleteMany({})).count;
      summary.checklistItems = (await (tx as any).checklistItem.deleteMany({})).count;
      summary.worklogs = (await (tx as any).worklog.deleteMany({})).count;
      summary.delegations = (await (tx as any).delegation.deleteMany({})).count;
      summary.approvalSteps = (await (tx as any).approvalStep.deleteMany({})).count;
      summary.approvalRequests = (await (tx as any).approvalRequest.deleteMany({})).count;
      summary.shares = (await (tx as any).share.deleteMany({})).count;
      summary.feedbacks = (await (tx as any).feedback.deleteMany({})).count;
      summary.notifications = (await (tx as any).notification.deleteMany({})).count;
      summary.events = (await (tx as any).event.deleteMany({})).count;
      summary.uploads = (await (tx as any).upload.deleteMany({})).count;
      summary.assets = (await (tx as any).asset.deleteMany({})).count;

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
      await tx.orgUnit.updateMany({ data: { managerId: null } });
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
      await (this.prisma as any).orgUnit.updateMany({ data: { managerId: null } });
    }, { timeout: 120000 });
    } catch (e: any) {
      // Provide a readable error instead of generic 500
      throw new BadRequestException(`wipe failed: ${e?.message || e}`);
    }
    return { ok: true, summary };
  }

  @Post('wipe/processes')
  async wipeProcesses(@Body() body: { confirm?: string }, @Query('userId') userId?: string) {
    await this.assertCeo(userId);
    if (!body?.confirm || body.confirm !== 'YES') {
      throw new BadRequestException("confirm must be 'YES'");
    }
    const summary: Record<string, number> = {};
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        summary.processStopEvents = (await (tx as any).processStopEvent.deleteMany({})).count;
        summary.processTaskInstances = (await (tx as any).processTaskInstance.deleteMany({})).count;
        summary.processInstances = (await (tx as any).processInstance.deleteMany({})).count;
        summary.processTaskTemplates = (await (tx as any).processTaskTemplate.deleteMany({})).count;
        summary.processTemplates = (await (tx as any).processTemplate.deleteMany({})).count;
      }, { timeout: 120000 });
    } catch (e: any) {
      throw new BadRequestException(`wipe processes failed: ${e?.message || e}`);
    }
    return { ok: true, summary };
  }

  @Post('wipe/worklogs')
  async wipeWorklogs(@Body() body: { confirm?: string }, @Query('userId') userId?: string) {
    await this.assertCeo(userId);
    if (!body?.confirm || body.confirm !== 'YES') {
      throw new BadRequestException("confirm must be 'YES'");
    }
    const summary: Record<string, number> = {};
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        const wlIds = (await (tx as any).worklog.findMany({ select: { id: true } })).map((w: any) => w.id);
        if (wlIds.length > 0) {
          summary.progressEntries = (await (tx as any).progressEntry.deleteMany({ where: { worklogId: { in: wlIds } } })).count;
        }
        summary.worklogs = (await (tx as any).worklog.deleteMany({})).count;
      }, { timeout: 120000 });
    } catch (e: any) {
      throw new BadRequestException(`wipe worklogs failed: ${e?.message || e}`);
    }
    return { ok: true, summary };
  }

  @Post('wipe/kpis')
  async wipeKpis(@Body() body: { confirm?: string }, @Query('userId') userId?: string) {
    await this.assertCeo(userId);
    if (!body?.confirm || body.confirm !== 'YES') {
      throw new BadRequestException("confirm must be 'YES'");
    }
    const summary: Record<string, number> = {};
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        const krs = await (tx as any).keyResult.findMany({ where: ({ type: 'OPERATIONAL' } as any), select: { id: true } });
        const krIds = krs.map((k: any) => k.id);
        if (krIds.length === 0) return;

        await (tx as any).objective.updateMany({ where: ({ alignsToKrId: { in: krIds } } as any), data: { alignsToKrId: null } });

        const deleteInitiativeCascade = async (id: string) => {
          const children = await (tx as any).initiative.findMany({ where: { parentId: id }, select: { id: true } });
          for (const ch of children) await deleteInitiativeCascade(ch.id);
          const items = await (tx as any).checklistItem.findMany({ where: { initiativeId: id }, select: { id: true } });
          if (items.length > 0) {
            await (tx as any).checklistTick.deleteMany({ where: { checklistItemId: { in: items.map((i: any) => i.id) } } });
          }
          await (tx as any).checklistItem.deleteMany({ where: { initiativeId: id } });
          await (tx as any).worklog.deleteMany({ where: { initiativeId: id } });
          await (tx as any).delegation.deleteMany({ where: { childInitiativeId: id } });
          await (tx as any).initiative.delete({ where: { id } });
        };

        const inits = await (tx as any).initiative.findMany({ where: { keyResultId: { in: krIds } }, select: { id: true } });
        for (const ii of inits) await deleteInitiativeCascade(ii.id);

        summary.keyResultAssignments = (await (tx as any).keyResultAssignment.deleteMany({ where: { keyResultId: { in: krIds } } })).count;
        summary.progressEntries = (await (tx as any).progressEntry.deleteMany({ where: { keyResultId: { in: krIds } } })).count;
        summary.keyResults = (await (tx as any).keyResult.deleteMany({ where: { id: { in: krIds } } })).count;
      }, { timeout: 120000 });
    } catch (e: any) {
      throw new BadRequestException(`wipe kpis failed: ${e?.message || e}`);
    }
    return { ok: true, summary };
  }

  @Post('wipe/okrs')
  async wipeOkrs(@Body() body: { confirm?: string }, @Query('userId') userId?: string) {
    await this.assertCeo(userId);
    if (!body?.confirm || body.confirm !== 'YES') {
      throw new BadRequestException("confirm must be 'YES'");
    }
    const summary: Record<string, number> = {};
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        const deleteInitiativeCascade = async (id: string) => {
          const children = await (tx as any).initiative.findMany({ where: { parentId: id }, select: { id: true } });
          for (const ch of children) await deleteInitiativeCascade(ch.id);
          const items = await (tx as any).checklistItem.findMany({ where: { initiativeId: id }, select: { id: true } });
          if (items.length > 0) {
            await (tx as any).checklistTick.deleteMany({ where: { checklistItemId: { in: items.map((i: any) => i.id) } } });
          }
          await (tx as any).checklistItem.deleteMany({ where: { initiativeId: id } });
          await (tx as any).worklog.deleteMany({ where: { initiativeId: id } });
          await (tx as any).delegation.deleteMany({ where: { childInitiativeId: id } });
          await (tx as any).initiative.delete({ where: { id } });
        };

        const deleteObjectiveCascade = async (id: string) => {
          const krs = await (tx as any).keyResult.findMany({ where: { objectiveId: id }, select: { id: true } });
          for (const kr of krs) {
            const alignedObjs = await (tx as any).objective.findMany({ where: ({ alignsToKrId: kr.id } as any), select: { id: true } });
            for (const o of alignedObjs) await deleteObjectiveCascade(o.id);
            const inits = await (tx as any).initiative.findMany({ where: { keyResultId: kr.id }, select: { id: true } });
            for (const ii of inits) await deleteInitiativeCascade(ii.id);
            await (tx as any).keyResultAssignment.deleteMany({ where: { keyResultId: kr.id } });
            await (tx as any).progressEntry.deleteMany({ where: { keyResultId: kr.id } });
            await (tx as any).keyResult.delete({ where: { id: kr.id } });
          }
          const children = await (tx as any).objective.findMany({ where: ({ parentId: id } as any), select: { id: true } });
          for (const ch of children) await deleteObjectiveCascade(ch.id);
          await (tx as any).objective.delete({ where: { id } });
        };

        const roots = await (tx as any).objective.findMany({ where: ({ alignsToKrId: null } as any), select: { id: true } });
        for (const r of roots) await deleteObjectiveCascade(r.id);

        summary.initiatives = (await (tx as any).initiative.deleteMany({})).count;
        summary.keyResults = (await (tx as any).keyResult.deleteMany({})).count;
        summary.objectives = (await (tx as any).objective.deleteMany({})).count;
      }, { timeout: 120000 });
    } catch (e: any) {
      throw new BadRequestException(`wipe okrs failed: ${e?.message || e}`);
    }
    return { ok: true, summary };
  }

  @Post('wipe/help-tickets')
  async wipeHelpTickets(@Body() body: { confirm?: string }, @Query('userId') userId?: string) {
    await this.assertCeo(userId);
    if (!body?.confirm || body.confirm !== 'YES') {
      throw new BadRequestException("confirm must be 'YES'");
    }
    const summary: Record<string, number> = {};
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        summary.notifications = (await (tx as any).notification.deleteMany({ where: { subjectType: 'HelpTicket' } })).count;
        summary.events = (await (tx as any).event.deleteMany({ where: { subjectType: 'HelpTicket' } })).count;
        summary.helpTickets = (await (tx as any).helpTicket.deleteMany({})).count;
      }, { timeout: 120000 });
    } catch (e: any) {
      throw new BadRequestException(`wipe help-tickets failed: ${e?.message || e}`);
    }
    return { ok: true, summary };
  }

  @Post('wipe/applications')
  async wipeApplications(@Body() body: { confirm?: string }, @Query('userId') userId?: string) {
    await this.assertCeo(userId);
    if (!body?.confirm || body.confirm !== 'YES') {
      throw new BadRequestException("confirm must be 'YES'");
    }
    const summary: Record<string, number> = {};
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        const subjectTypes = ['ATTENDANCE', 'CAR_DISPATCH'];
        const approvals = await (tx as any).approvalRequest.findMany({ where: { subjectType: { in: subjectTypes } }, select: { id: true } });
        const approvalIds = (approvals || []).map((a: any) => a.id);
        if (approvalIds.length > 0) {
          summary.approvalSteps = (await (tx as any).approvalStep.deleteMany({ where: { requestId: { in: approvalIds } } })).count;
          summary.approvalRequests = (await (tx as any).approvalRequest.deleteMany({ where: { id: { in: approvalIds } } })).count;
        } else {
          summary.approvalSteps = 0;
          summary.approvalRequests = 0;
        }
        summary.notifications = (await (tx as any).notification.deleteMany({ where: { subjectType: { in: subjectTypes as any } } })).count;
        summary.events = (await (tx as any).event.deleteMany({ where: { subjectType: { in: subjectTypes as any } } })).count;
        summary.attendanceRequests = (await (tx as any).attendanceRequest.deleteMany({})).count;
        summary.carDispatchRequests = (await (tx as any).carDispatchRequest.deleteMany({})).count;
      }, { timeout: 120000 });
    } catch (e: any) {
      throw new BadRequestException(`wipe applications failed: ${e?.message || e}`);
    }
    return { ok: true, summary };
  }

  @Post('wipe/approvals')
  async wipeApprovals(@Body() body: { confirm?: string }, @Query('userId') userId?: string) {
    await this.assertCeo(userId);
    if (!body?.confirm || body.confirm !== 'YES') {
      throw new BadRequestException("confirm must be 'YES'");
    }
    const summary: Record<string, number> = {};
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        summary.notifications = (await (tx as any).notification.deleteMany({ where: { type: { in: ['ApprovalRequested', 'ApprovalGranted', 'ApprovalRejected'] as any } } })).count;
        summary.events = (await (tx as any).event.deleteMany({ where: { OR: [{ subjectType: 'ApprovalStep' }, { activity: { in: ['ApprovalRequested', 'ApprovalGranted', 'ApprovalRejected', 'ApprovalStepApproved'] as any } }] } })).count;
        summary.approvalSteps = (await (tx as any).approvalStep.deleteMany({})).count;
        summary.approvalRequests = (await (tx as any).approvalRequest.deleteMany({})).count;
      }, { timeout: 120000 });
    } catch (e: any) {
      throw new BadRequestException(`wipe approvals failed: ${e?.message || e}`);
    }
    return { ok: true, summary };
  }

  @Post('wipe/user-goals')
  async wipeUserGoals(@Body() body: { confirm?: string }, @Query('userId') userId?: string) {
    await this.assertCeo(userId);
    if (!body?.confirm || body.confirm !== 'YES') {
      throw new BadRequestException("confirm must be 'YES'");
    }
    const summary: Record<string, number> = {};
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        // unlink FK first (Initiative.userGoalId -> UserGoal.id)
        summary.initiativesUnlinked = (await (tx as any).initiative.updateMany({
          where: { userGoalId: { not: null } },
          data: { userGoalId: null },
        })).count;
        summary.userGoals = (await (tx as any).userGoal.deleteMany({})).count;
      }, { timeout: 120000 });
    } catch (e: any) {
      throw new BadRequestException(`wipe user-goals failed: ${e?.message || e}`);
    }
    return { ok: true, summary };
  }

  @Get('user-data')
  async userData(
    @Query('userId') userId?: string,
    @Query('targetUserId') targetUserId?: string,
    @Query('q') q?: string,
  ) {
    await this.assertCeo(userId);

    const take = 10;
    let users: Array<{ id: string; name: string; email: string; teamsUpn?: string | null }> = [];
    if (targetUserId) {
      const u = await (this.prisma as any).user.findUnique({
        where: { id: targetUserId },
        select: { id: true, name: true, email: true, teamsUpn: true },
      });
      if (u) users = [u];
    } else if (q && String(q).trim()) {
      const qq = String(q).trim();
      users = await (this.prisma as any).user.findMany({
        where: {
          OR: [
            { name: { contains: qq, mode: 'insensitive' as any } },
            { email: { contains: qq, mode: 'insensitive' as any } },
            { teamsUpn: { contains: qq, mode: 'insensitive' as any } },
          ],
        },
        select: { id: true, name: true, email: true, teamsUpn: true },
        take,
        orderBy: { name: 'asc' },
      });
    }

    if (!users.length) throw new BadRequestException('target user not found');

    const items = await Promise.all(
      users.map(async (u) => {
        const uid = u.id;

        const [
          worklogs,
          approvals,
          approvalSteps,
          helpTickets,
          attendance,
          carDispatch,
          notifications,
          events,
          shares,
          feedbacks,
          delegations,
          checklistTicks,
          progressEntries,
          keyResultAssignments,
          objectivesOwned,
          keyResultsOwned,
          initiativesOwned,
          processTemplatesOwned,
          processInstances,
          processStopEvents,
          processTaskInstances,
          userGoals,
          orgUnitsManaged,
        ] = await Promise.all([
          (this.prisma as any).worklog.count({ where: { createdById: uid } }),
          (this.prisma as any).approvalRequest.count({ where: { OR: [{ requestedById: uid }, { approverId: uid }] } }),
          (this.prisma as any).approvalStep.count({ where: { approverId: uid } }),
          (this.prisma as any).helpTicket.count({ where: { OR: [{ requesterId: uid }, { assigneeId: uid }] } }),
          (this.prisma as any).attendanceRequest.count({ where: { userId: uid } }),
          (this.prisma as any).carDispatchRequest.count({ where: { OR: [{ requesterId: uid }, { approverId: uid }] } }),
          (this.prisma as any).notification.count({ where: { userId: uid } }),
          (this.prisma as any).event.count({ where: { userId: uid } }),
          (this.prisma as any).share.count({ where: { watcherId: uid } }),
          (this.prisma as any).feedback.count({ where: { authorId: uid } }),
          (this.prisma as any).delegation.count({ where: { OR: [{ delegatorId: uid }, { delegateeId: uid }] } }),
          (this.prisma as any).checklistTick.count({ where: { actorId: uid } }),
          (this.prisma as any).progressEntry.count({ where: { actorId: uid } }),
          (this.prisma as any).keyResultAssignment.count({ where: { userId: uid } }),
          (this.prisma as any).objective.count({ where: { ownerId: uid } }),
          (this.prisma as any).keyResult.count({ where: { ownerId: uid } }),
          (this.prisma as any).initiative.count({ where: { ownerId: uid } }),
          (this.prisma as any).processTemplate.count({ where: { ownerId: uid } }),
          (this.prisma as any).processInstance.count({ where: { OR: [{ startedById: uid }, { modifiedById: uid }] } }),
          (this.prisma as any).processStopEvent.count({ where: { stoppedById: uid } }),
          (this.prisma as any).processTaskInstance.count({ where: { OR: [{ assigneeId: uid }, { decidedById: uid }] } }),
          (this.prisma as any).userGoal.count({ where: { userId: uid } }),
          (this.prisma as any).orgUnit.count({ where: { managerId: uid } }),
        ]);

        const worklogSamples = await (this.prisma as any).worklog.findMany({
          where: { createdById: uid },
          select: { id: true, createdAt: true, date: true, note: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 5,
        });

        const approvalSamples = await (this.prisma as any).approvalRequest.findMany({
          where: { OR: [{ requestedById: uid }, { approverId: uid }] },
          select: { id: true, subjectType: true, subjectId: true, status: true, requestedById: true, approverId: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 5,
        });

        const helpTicketSamples = await (this.prisma as any).helpTicket.findMany({
          where: { OR: [{ requesterId: uid }, { assigneeId: uid }] },
          select: { id: true, category: true, status: true, requesterId: true, assigneeId: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 5,
        });

        const notificationSamples = await (this.prisma as any).notification.findMany({
          where: { userId: uid },
          select: { id: true, type: true, subjectType: true, subjectId: true, readAt: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 5,
        });

        const mappedWorklogSamples = (worklogSamples || []).map((w: any) => {
          const lines = String(w.note || '').split(/\n+/);
          const title = lines[0] || '(제목 없음)';
          return { id: String(w.id), title, createdAt: w.createdAt, date: w.date };
        });

        return {
          user: u,
          counts: {
            worklogs,
            approvals,
            approvalSteps,
            helpTickets,
            attendanceRequests: attendance,
            carDispatchRequests: carDispatch,
            notifications,
            events,
            shares,
            feedbacks,
            delegations,
            checklistTicks,
            progressEntries,
            keyResultAssignments,
            objectivesOwned,
            keyResultsOwned,
            initiativesOwned,
            processTemplatesOwned,
            processInstances,
            processStopEvents,
            processTaskInstances,
            userGoals,
            orgUnitsManaged,
          },
          samples: {
            worklogs: mappedWorklogSamples,
            approvals: approvalSamples || [],
            helpTickets: helpTicketSamples || [],
            notifications: notificationSamples || [],
          },
        };
      }),
    );

    return { ok: true, items };
  }
}
