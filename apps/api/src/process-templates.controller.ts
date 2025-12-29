import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('process-templates')
export class ProcessTemplatesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Query('ownerId') ownerId?: string) {
    const where: any = {};
    if (ownerId) {
      where.ownerId = ownerId;
    }
    return this.prisma.processTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { tasks: { orderBy: { orderHint: 'asc' } } },
    });
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.prisma.processTemplate.findUnique({
      where: { id },
      include: { tasks: { orderBy: { orderHint: 'asc' } } },
    });
  }

  @Post()
  async create(@Body() body: any) {
    const {
      title,
      description,
      type,
      ownerId,
      visibility,
      orgUnitId,
      recurrenceType,
      recurrenceDetail,
      resultInputRequired,
      expectedDurationDays,
      expectedCompletionCriteria,
      allowExtendDeadline,
      status,
      tasks,
    } = body;

    return this.prisma.processTemplate.create({
      data: {
        title,
        description,
        type,
        ownerId,
        visibility,
        orgUnitId,
        recurrenceType,
        recurrenceDetail,
        resultInputRequired,
        expectedDurationDays,
        expectedCompletionCriteria,
        allowExtendDeadline,
        status,
        tasks: tasks && Array.isArray(tasks)
          ? {
              create: tasks.map((t: any, idx: number) => ({
                name: t.name,
                description: t.description,
                assigneeHint: t.assigneeHint,
                stageLabel: t.stageLabel,
                taskType: t.taskType,
                orderHint: t.orderHint ?? idx,
                predecessorIds: t.predecessorIds,
                assigneeType: t.assigneeType,
                assigneeUserId: t.assigneeUserId,
                assigneeOrgUnitId: t.assigneeOrgUnitId,
                assigneeRoleCode: t.assigneeRoleCode,
                cooperationTargetType: t.cooperationTargetType,
                cooperationTargetUserId: t.cooperationTargetUserId,
                cooperationTargetOrgUnitId: t.cooperationTargetOrgUnitId,
                cooperationTargetRoleCode: t.cooperationTargetRoleCode,
                expectedOutput: t.expectedOutput,
                worklogTemplateHint: t.worklogTemplateHint,
                linkToKpiType: t.linkToKpiType,
                approvalRouteType: t.approvalRouteType,
                approvalRoleCodes: t.approvalRoleCodes,
                approvalUserIds: t.approvalUserIds,
                isFinalApproval: t.isFinalApproval,
                deadlineOffsetDays: t.deadlineOffsetDays,
                slaHours: t.slaHours,
                allowDelayReasonRequired: t.allowDelayReasonRequired,
              })),
            }
          : undefined,
      },
      include: { tasks: true },
    });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const {
      title,
      description,
      type,
      ownerId,
      visibility,
      orgUnitId,
      recurrenceType,
      recurrenceDetail,
      resultInputRequired,
      expectedDurationDays,
      expectedCompletionCriteria,
      allowExtendDeadline,
      status,
      tasks,
    } = body;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.processTemplate.update({
        where: { id },
        data: {
          title,
          description,
          type,
          ownerId,
          visibility,
          orgUnitId,
          recurrenceType,
          recurrenceDetail,
          resultInputRequired,
          expectedDurationDays,
          expectedCompletionCriteria,
          allowExtendDeadline,
          status,
        },
      });

      if (Array.isArray(tasks)) {
        await tx.processTaskTemplate.deleteMany({ where: { processTemplateId: id } });
        await tx.processTaskTemplate.createMany({
          data: tasks.map((t: any, idx: number) => ({
            processTemplateId: id,
            name: t.name,
            description: t.description,
            assigneeHint: t.assigneeHint,
            stageLabel: t.stageLabel,
            taskType: t.taskType,
            orderHint: t.orderHint ?? idx,
            predecessorIds: t.predecessorIds,
            assigneeType: t.assigneeType,
            assigneeUserId: t.assigneeUserId,
            assigneeOrgUnitId: t.assigneeOrgUnitId,
            assigneeRoleCode: t.assigneeRoleCode,
            cooperationTargetType: t.cooperationTargetType,
            cooperationTargetUserId: t.cooperationTargetUserId,
            cooperationTargetOrgUnitId: t.cooperationTargetOrgUnitId,
            cooperationTargetRoleCode: t.cooperationTargetRoleCode,
            expectedOutput: t.expectedOutput,
            worklogTemplateHint: t.worklogTemplateHint,
            linkToKpiType: t.linkToKpiType,
            approvalRouteType: t.approvalRouteType,
            approvalRoleCodes: t.approvalRoleCodes,
            approvalUserIds: t.approvalUserIds,
            isFinalApproval: t.isFinalApproval,
            deadlineOffsetDays: t.deadlineOffsetDays,
            slaHours: t.slaHours,
            allowDelayReasonRequired: t.allowDelayReasonRequired,
          })),
        });
      }

      return tx.processTemplate.findUnique({
        where: { id },
        include: { tasks: { orderBy: { orderHint: 'asc' } } },
      });
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.processTaskTemplate.deleteMany({ where: { processTemplateId: id } });
    await this.prisma.processTemplate.delete({ where: { id } });
    return { ok: true };
  }
}
