import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsDateString, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from './prisma.service';
import { ProcessesController } from './processes.controller';
import { ExecInstructionsController } from './exec-instructions/exec-instructions.controller';

class CreateApprovalDto {
  @IsString()
  @IsNotEmpty()
  subjectType!: string;

  @IsString()
  @IsNotEmpty()
  subjectId!: string;

  @IsOptional()
  @IsString()
  approverId?: string; // when steps[] provided, approverId will default to first step's approver

  @IsString()
  @IsNotEmpty()
  requestedById!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateApprovalStepInput)
  steps?: CreateApprovalStepInput[];

  @IsOptional()
  tags?: any;
}

class ActApprovalDto {
  @IsString()
  @IsNotEmpty()
  actorId!: string;

  @IsOptional()
  @IsString()
  comment?: string;
}

class CreateApprovalStepInput {
  @IsString()
  @IsNotEmpty()
  approverId!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

class ListApprovalsQueryDto {
  @IsOptional() @IsString()
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

  @IsOptional() @IsString()
  requestedById?: string;

  @IsOptional() @IsString()
  approverId?: string;

  @IsOptional() @IsString()
  query?: string;

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;

  @IsOptional() @IsString()
  limit?: string;

  @IsOptional() @IsString()
  cursor?: string;

  @IsOptional() @IsString()
  offset?: string;

  @IsOptional() @IsString()
  withTotal?: string;

  @IsOptional() @IsString()
  currentApproverOnly?: string; // 'true' to filter only where user is current approver

  @IsOptional() @IsString()
  subjectType?: string; // ATTENDANCE, BUSINESS_TRIP, CAR_DISPATCH, LOGISTICS_DISPATCH, etc.

  @IsOptional() @IsString()
  subjectGroup?: string; // 'REQUEST'(신청류) | 'APPROVAL'(일반결재) — 서버측 그룹 필터

  @IsOptional() @IsString()
  requesterName?: string; // 신청자(구성원) 이름으로 필터

  @IsOptional() @IsString()
  titleQuery?: string; // 문서 제목(대상 문서 내용) 검색 — 일지/배차/근태/출장/프로세스 전체
}

@Controller('approvals')
export class ApprovalsController {
  constructor(private prisma: PrismaService) {}

  /**
   * 제목 검색: 결재 목록의 제목은 대상 문서에서 조립되므로(일지 첫 줄, 배차 목적지,
   * 근태 종류, 출장지, 프로세스명), 각 대상 테이블을 검색해 subjectId 필터로 변환한다.
   */
  private async titleSubjectFilter(tqRaw?: string): Promise<any | null> {
    const tq = String(tqRaw || '').trim();
    if (!tq) return null;
    const c = { contains: tq, mode: 'insensitive' as any };
    const low = tq.toLowerCase();
    // 근태 제목의 [종류] 라벨은 enum이라, 라벨 키워드가 검색어에 걸리면 해당 type도 포함
    const KIND_LABELS: Array<[string, string[]]> = [
      ['OT', ['ot', '오티', '연장근무']],
      ['VACATION', ['휴가', '연차']],
      ['PARENTAL_LEAVE', ['육아휴직', '육아']],
      ['PUBLIC_DUTY', ['공가']],
      ['EARLY_LEAVE', ['조퇴']],
      ['FLEXIBLE', ['유연근무']],
      ['HOLIDAY_WORK', ['휴일근무', '휴일대체']],
      ['HOLIDAY_REST', ['대체휴무', '휴일대체']],
    ];
    const attTypes = KIND_LABELS.filter(([, ls]) => ls.some((l) => l.includes(low) || low.includes(l))).map(([t]) => t);
    const take = 2000;
    const [wls, cars, logis, atts, trips, procs] = await Promise.all([
      this.prisma.worklog.findMany({ where: { note: c }, select: { id: true }, take }),
      this.prisma.carDispatchRequest.findMany({ where: { OR: [{ destination: c }, { purpose: c }] }, select: { id: true }, take }),
      (this.prisma as any).logisticsDispatchRequest.findMany({ where: { OR: [{ loadingPlace: c }, { unloadingPlace: c }, { vehicleType: c }, { cargoDetails: c }] }, select: { id: true }, take }),
      this.prisma.attendanceRequest.findMany({ where: { OR: [{ reason: c }, ...(attTypes.length ? [{ type: { in: attTypes as any } }] : [])] }, select: { id: true }, take }),
      (this.prisma as any).businessTripRequest.findMany({ where: { OR: [{ destination: c }, { purpose: c }] }, select: { id: true }, take }),
      (this.prisma as any).processInstance.findMany({ where: { title: c }, select: { id: true }, take }),
    ]);
    const or: any[] = [];
    const push = (type: string, rows: any[]) => {
      if (rows.length) or.push({ subjectType: { equals: type, mode: 'insensitive' as any }, subjectId: { in: rows.map((r: any) => String(r.id)) } });
    };
    push('WORKLOG', wls); // DB에는 'Worklog'로 저장된 건도 있어 equals-insensitive 사용
    push('CAR_DISPATCH', cars);
    push('LOGISTICS_DISPATCH', logis);
    push('ATTENDANCE', atts);
    push('BUSINESS_TRIP', trips);
    push('PROCESS', procs);
    if (!or.length) return { id: '__no_title_match__' }; // 아무 문서도 안 걸리면 빈 결과
    return { OR: or };
  }

  @Get()
  async list(@Query() q: ListApprovalsQueryDto) {
    const where: any = {};
    if (q.status) where.status = q.status;
    const REQUEST_TYPES = ['CAR_DISPATCH', 'LOGISTICS_DISPATCH', 'ATTENDANCE', 'BUSINESS_TRIP'];
    if (q.subjectType) where.subjectType = q.subjectType.toUpperCase();
    else if (q.subjectGroup === 'REQUEST') where.subjectType = { in: REQUEST_TYPES };
    else if (q.subjectGroup === 'APPROVAL') where.subjectType = { notIn: REQUEST_TYPES };
    if (q.requestedById) where.requestedById = q.requestedById;
    // 결재자 범위와 검색어는 각각 별개의 OR 그룹이므로 AND 로 결합한다.
    // (둘 다 where.OR 에 직접 대입하면 뒤 조건이 앞 조건을 덮어써 결재자 범위가 사라짐)
    const and: any[] = [];
    if (q.approverId) {
      and.push({ OR: [
        { approverId: q.approverId },
        { steps: { some: { approverId: q.approverId } } },
      ] });
    }
    const term = String(q.query || '').trim();
    if (term) {
      and.push({ OR: [
        { subjectType: { contains: term, mode: 'insensitive' as any } },
        { subjectId: { contains: term, mode: 'insensitive' as any } },
        { requestedBy: { name: { contains: term, mode: 'insensitive' as any } } },
        { approver: { name: { contains: term, mode: 'insensitive' as any } } },
        { steps: { some: { comment: { contains: term, mode: 'insensitive' as any } } } },
      ] });
    }
    const rname = String(q.requesterName || '').trim();
    if (rname) {
      and.push({ requestedBy: { name: { contains: rname, mode: 'insensitive' as any } } });
    }
    const titleFilter = await this.titleSubjectFilter(q.titleQuery);
    if (titleFilter) and.push(titleFilter);
    if (and.length) where.AND = and;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as any).gte = new Date(q.from);
      if (q.to) (where.createdAt as any).lte = new Date(q.to);
    }
    const limit = Math.min(parseInt(q.limit || '20', 10) || 20, 100);
    const offset = parseInt(q.offset || '0', 10) || 0;
    const wantTotal = q.withTotal === '1' || q.withTotal === 'true';

    // If offset is provided, use offset-based pagination instead of cursor
    const useCursor = !q.offset && q.cursor;

    // "내 차례"인 결재만 보기: 사용자가 '현재 대기 중인 단계'의 결재자인 건만 표시.
    // where.OR 는 사용자가 '어느 단계든' 결재자이면 매칭되므로(이미 승인한 단계·
    // 아직 차례가 안 온 미래 단계 포함), 이 조건으로 DB 페이지네이션을 먼저 하면
    // 현재 차례가 아닌 건이 페이지를 차지해 실제 결재 대상이 누락된다. 따라서
    // currentApproverOnly 인 경우 전체를 받아 '내 차례' 필터를 먼저 적용한 뒤
    // 메모리에서 페이징한다.
    const currentApproverOnly = q.currentApproverOnly === 'true' || q.currentApproverOnly === '1';
    const isMyTurn = (a: any): boolean => {
      if (a.status !== 'PENDING') return false;
      const steps = a.steps || [];
      if (steps.length > 0) {
        // Multi-step: PENDING 스텝 중 가장 낮은 stepNo가 현재 스테이지.
        // 같은 stepNo에 여러 결재자가 있으면 any-of(그 중 누구든 현재 차례).
        const pendingSteps = steps.filter((s: any) => s.status === 'PENDING');
        if (!pendingSteps.length) return false;
        const stageNo = Math.min(...pendingSteps.map((s: any) => s.stepNo));
        return pendingSteps.some((s: any) => s.stepNo === stageNo && s.approverId === q.approverId);
      }
      // Single-step: 지정된 결재자
      return a.approverId === q.approverId;
    };

    let filtered: any[];
    let total: number | undefined;
    let nextCursor: string | undefined;

    if (currentApproverOnly && q.approverId) {
      // "내 차례"의 필요조건을 DB WHERE로 먼저 좁힌다: PENDING 이면서
      // (다단계: 내 PENDING 단계가 존재) 또는 (단일: 내가 지정 결재자이고 단계 없음).
      // 정확한 "가장 앞선 PENDING 단계가 나" 판정은 아래 isMyTurn이 하되,
      // 후보군이 수백 건 전체에서 수십 건으로 줄어 풀 로드를 피한다.
      const narrowedWhere: any = {
        ...where,
        status: 'PENDING',
        AND: [
          ...(Array.isArray(where.AND) ? where.AND : []),
          { OR: [
            { steps: { some: { approverId: q.approverId, status: 'PENDING' as any } } },
            { AND: [{ approverId: q.approverId }, { steps: { none: {} } }] },
          ] },
        ],
      };
      const allMatching = await this.prisma.approvalRequest.findMany({
        where: narrowedWhere,
        orderBy: { createdAt: 'desc' },
        include: {
          requestedBy: true,
          approver: true,
          steps: { orderBy: { stepNo: 'asc' }, include: { approver: true } },
        },
      });
      const myTurn = allMatching.filter(isMyTurn);
      if (wantTotal) total = myTurn.length;
      filtered = myTurn.slice(offset, offset + limit);
      nextCursor = offset + limit < myTurn.length ? filtered[filtered.length - 1]?.id : undefined;
    } else {
      const items = await this.prisma.approvalRequest.findMany({
        where,
        take: limit,
        skip: useCursor ? 1 : offset,
        ...(useCursor ? { cursor: { id: q.cursor } } : {}),
        orderBy: { createdAt: 'desc' },
        include: {
          requestedBy: true,
          approver: true,
          steps: { orderBy: { stepNo: 'asc' }, include: { approver: true } },
        },
      });
      filtered = items;
      nextCursor = filtered.length === limit ? filtered[filtered.length - 1]?.id : undefined;
      if (wantTotal) total = await this.prisma.approvalRequest.count({ where });
    }
    return {
      items: filtered.map((a: any) => {
        // 스텝 기준으로 최종 상태 계산 (DB 불일치 보정)
        const steps = a.steps || [];
        const allStepsApproved = steps.length > 0 && steps.every((s: any) => s.status === 'APPROVED');
        const anyStepRejected = steps.some((s: any) => s.status === 'REJECTED');
        let computedStatus = a.status;
        if (allStepsApproved) computedStatus = 'APPROVED';
        else if (anyStepRejected) computedStatus = 'REJECTED';

        return {
          id: a.id,
          subjectType: a.subjectType,
          subjectId: a.subjectId,
          status: computedStatus,
          requestedBy: a.requestedBy ? { id: a.requestedBy.id, name: a.requestedBy.name } : null,
          currentApprover: a.approver ? { id: a.approver.id, name: a.approver.name } : null,
          dueAt: a.dueAt || null,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          steps: steps.map((s: any) => ({
            id: s.id,
            stepNo: s.stepNo,
            approverId: s.approverId,
            approver: s.approver ? { id: s.approver.id, name: s.approver.name } : null,
            status: s.status,
            actedAt: s.actedAt || null,
            comment: s.comment || null,
          })),
        };
      }),
      nextCursor,
      ...(total !== undefined ? { total } : {}),
    };
  }

  @Get('summary')
  async summary(@Query() q: ListApprovalsQueryDto) {
    const where: any = {};
    if (q.requestedById) where.requestedById = q.requestedById;
    // 결재자 범위와 검색어는 각각 별개의 OR 그룹이므로 AND 로 결합한다(list 와 동일).
    const and: any[] = [];
    if (q.approverId) {
      and.push({ OR: [
        { approverId: q.approverId },
        { steps: { some: { approverId: q.approverId } } },
      ] });
    }
    const term = String(q.query || '').trim();
    if (term) {
      and.push({ OR: [
        { subjectType: { contains: term, mode: 'insensitive' as any } },
        { subjectId: { contains: term, mode: 'insensitive' as any } },
        { requestedBy: { name: { contains: term, mode: 'insensitive' as any } } },
        { approver: { name: { contains: term, mode: 'insensitive' as any } } },
        { steps: { some: { comment: { contains: term, mode: 'insensitive' as any } } } },
      ] });
    }
    const rname = String(q.requesterName || '').trim();
    if (rname) {
      and.push({ requestedBy: { name: { contains: rname, mode: 'insensitive' as any } } });
    }
    const titleFilter = await this.titleSubjectFilter(q.titleQuery);
    if (titleFilter) and.push(titleFilter);
    if (and.length) where.AND = and;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as any).gte = new Date(q.from);
      if (q.to) (where.createdAt as any).lte = new Date(q.to);
    }
    const rows = await (this.prisma as any).approvalRequest.groupBy({
      by: ['status'],
      _count: { _all: true },
      where,
    });
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r._count._all;
    for (const k of ['PENDING','APPROVED','REJECTED','EXPIRED']) if (!(k in out)) out[k] = 0;
    return { counts: out };
  }

  @Post()
  async create(@Body() dto: CreateApprovalDto) {
    const steps = Array.isArray(dto.steps) ? dto.steps.filter(s => s && s.approverId) : [];
    const firstApprover = steps.length > 0 ? steps[0].approverId : dto.approverId;
    if (!firstApprover) throw new BadRequestException('approverId or steps[0].approverId is required');

    const req = await this.prisma.approvalRequest.create({
      data: {
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        approverId: firstApprover,
        requestedById: dto.requestedById,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        tags: (dto as any).tags as any,
      },
    });

    // Create steps if provided
    if (steps.length > 0) {
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        await this.prisma.approvalStep.create({
          data: {
            requestId: req.id,
            stepNo: i + 1,
            approverId: s.approverId,
            status: 'PENDING' as any,
            actedAt: undefined,
            comment: undefined,
          },
        });
      }
    }

    await this.prisma.event.create({
      data: {
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        activity: 'ApprovalRequested',
        userId: dto.requestedById,
        attrs: { approverId: firstApprover, requestId: req.id, steps: steps.length },
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: firstApprover,
        type: 'ApprovalRequested',
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        payload: { requestId: req.id, requestedById: dto.requestedById },
      },
    });
    return req;
  }

  @Post('batch-subjects')
  async batchSubjects(@Body() body: { items: Array<{ subjectType: string; subjectId: string }> }) {
    const list = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
    const results: Record<string, any> = {};

    // 타입별로 id를 모아 IN 벌크 조회 (건별 findUnique N회 → 타입당 1회, 병렬 실행)
    const idsByType: Record<string, Set<string>> = {};
    for (const item of list) {
      const st = String(item.subjectType || '').toUpperCase();
      const sid = item.subjectId;
      if (!sid) continue;
      if (!idsByType[st]) idsByType[st] = new Set();
      idsByType[st].add(sid);
    }
    const ids = (st: string) => Array.from(idsByType[st] || []);
    const toMap = (rows: any[]): Record<string, any> => {
      const m: Record<string, any> = {};
      for (const r of rows) if (r && r.id) m[r.id] = r;
      return m;
    };

    try {
      const worklogIds = [...ids('WORKLOG'), ...ids('WORKLOGS')];
      const [worklogs, cars, logistics, attendance, trips, processes] = await Promise.all([
        worklogIds.length ? this.prisma.worklog.findMany({ where: { id: { in: worklogIds } }, include: { createdBy: { select: { id: true, name: true } } } }) : Promise.resolve([]),
        ids('CAR_DISPATCH').length ? this.prisma.carDispatchRequest.findMany({ where: { id: { in: ids('CAR_DISPATCH') } }, include: { requester: { select: { id: true, name: true } }, car: { select: { name: true, type: true } } } }) : Promise.resolve([]),
        ids('LOGISTICS_DISPATCH').length ? (this.prisma as any).logisticsDispatchRequest.findMany({ where: { id: { in: ids('LOGISTICS_DISPATCH') } }, include: { requester: { select: { id: true, name: true } } } }) : Promise.resolve([]),
        ids('ATTENDANCE').length ? this.prisma.attendanceRequest.findMany({ where: { id: { in: ids('ATTENDANCE') } }, include: { user: { select: { id: true, name: true } } } }) : Promise.resolve([]),
        ids('BUSINESS_TRIP').length ? (this.prisma as any).businessTripRequest.findMany({ where: { id: { in: ids('BUSINESS_TRIP') } }, include: { requester: { select: { id: true, name: true } } } }) : Promise.resolve([]),
        ids('PROCESS').length ? this.prisma.processInstance.findMany({ where: { id: { in: ids('PROCESS') } }, include: { startedBy: { select: { id: true, name: true } } } }) : Promise.resolve([]),
      ]);
      const wlMap = toMap(worklogs as any[]);
      const maps: Record<string, Record<string, any>> = {
        WORKLOG: wlMap,
        WORKLOGS: wlMap,
        CAR_DISPATCH: toMap(cars as any[]),
        LOGISTICS_DISPATCH: toMap(logistics as any[]),
        ATTENDANCE: toMap(attendance as any[]),
        BUSINESS_TRIP: toMap(trips as any[]),
        PROCESS: toMap(processes as any[]),
      };
      for (const item of list) {
        const key = `${item.subjectType}::${item.subjectId}`;
        if (results[key] !== undefined) continue;
        const st = String(item.subjectType || '').toUpperCase();
        results[key] = (maps[st] && maps[st][item.subjectId]) ?? null;
      }
    } catch {
      for (const item of list) {
        const key = `${item.subjectType}::${item.subjectId}`;
        if (results[key] === undefined) results[key] = null;
      }
    }
    return { results };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const a = await this.prisma.approvalRequest.findUnique({
      where: { id },
      include: {
        requestedBy: true,
        approver: true,
        steps: {
          orderBy: { stepNo: 'asc' },
          include: { approver: true },
        },
      },
    });
    if (!a) throw new BadRequestException('request not found');

    // 스텝 기준으로 최종 상태 계산 (DB 불일치 보정)
    const steps = a.steps || [];
    const allStepsApproved = steps.length > 0 && steps.every((s: any) => s.status === 'APPROVED');
    const anyStepRejected = steps.some((s: any) => s.status === 'REJECTED');
    let computedStatus = a.status;
    if (allStepsApproved) computedStatus = 'APPROVED';
    else if (anyStepRejected) computedStatus = 'REJECTED';

    return {
      id: a.id,
      subjectType: a.subjectType,
      subjectId: a.subjectId,
      status: computedStatus,
      requestedBy: a.requestedBy ? { id: a.requestedBy.id, name: a.requestedBy.name } : null,
      currentApprover: a.approver ? { id: a.approver.id, name: a.approver.name } : null,
      dueAt: a.dueAt || null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      steps: steps.map((s: any) => ({
        id: s.id,
        stepNo: s.stepNo,
        approverId: s.approverId,
        approver: s.approver ? { id: s.approver.id, name: s.approver.name } : null,
        status: s.status,
        actedAt: s.actedAt || null,
        comment: s.comment || null,
      })),
    };
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Body() dto: ActApprovalDto) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id }, include: { steps: { orderBy: { stepNo: 'asc' } } } });
    if (!req) throw new BadRequestException('request not found');

    if (!req.steps || req.steps.length === 0) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await (tx as any).approvalRequest.update({ where: { id }, data: { status: 'APPROVED' } });
        if (updated.subjectType === 'CAR_DISPATCH') {
          await (tx as any).carDispatchRequest.update({ where: { id: updated.subjectId }, data: { status: 'APPROVED' as any } });
        }
        if (updated.subjectType === 'LOGISTICS_DISPATCH') {
          await (tx as any).logisticsDispatchRequest.update({ where: { id: updated.subjectId }, data: { status: 'APPROVED' as any } });
        }
        if (updated.subjectType === 'BUSINESS_TRIP') {
          await (tx as any).businessTripRequest.update({ where: { id: updated.subjectId }, data: { status: 'APPROVED' as any } });
        }
        if (updated.subjectType === 'ATTENDANCE') {
          await (tx as any).attendanceRequest.update({ where: { id: updated.subjectId }, data: { status: 'APPROVED' as any } });
        }
        const engine = new ProcessesController(this.prisma);
        await engine.finalizeTasksLinkedToApprovalRequest(tx as any, id, dto.actorId, dto.comment);
        if (updated.subjectType === 'INSTRUCTION_MILESTONE') {
          const exec = new ExecInstructionsController(this.prisma);
          await exec.finalizeMilestoneApproval(tx as any, id, 'APPROVED', dto.actorId, dto.comment);
        }
        await (tx as any).event.create({ data: { subjectType: updated.subjectType, subjectId: updated.subjectId, activity: 'ApprovalGranted', userId: dto.actorId, attrs: { requestId: id, comment: dto.comment } } });
        await (tx as any).notification.create({ data: { userId: updated.requestedById, type: 'ApprovalGranted', subjectType: updated.subjectType, subjectId: updated.subjectId, payload: { requestId: id } } });
        return updated;
      });
    }

    // multi-step
    const pending = req.steps.find((s: any) => s.status === 'PENDING');
    if (!pending) {
      // 모든 스텝이 승인됨 - subject 상태 동기화 (race condition 보정)
      const allApproved = req.steps.every((s: any) => s.status === 'APPROVED');
      if (allApproved && req.status !== 'APPROVED') {
        await this.prisma.$transaction(async (tx) => {
          await (tx as any).approvalRequest.update({ where: { id }, data: { status: 'APPROVED' } });
          if (req.subjectType === 'ATTENDANCE') {
            await (tx as any).attendanceRequest.update({ where: { id: req.subjectId }, data: { status: 'APPROVED' as any } });
          }
          if (req.subjectType === 'CAR_DISPATCH') {
            await (tx as any).carDispatchRequest.update({ where: { id: req.subjectId }, data: { status: 'APPROVED' as any } });
          }
          if (req.subjectType === 'LOGISTICS_DISPATCH') {
            await (tx as any).logisticsDispatchRequest.update({ where: { id: req.subjectId }, data: { status: 'APPROVED' as any } });
          }
          if (req.subjectType === 'BUSINESS_TRIP') {
            await (tx as any).businessTripRequest.update({ where: { id: req.subjectId }, data: { status: 'APPROVED' as any } });
          }
        });
      }
      return req;
    }
    // 현재 스테이지 = PENDING 스텝 중 가장 낮은 stepNo. 같은 stepNo = any-of 병렬 그룹(하나만 승인하면 통과).
    const currentStageNo = Math.min(...req.steps.filter((s: any) => s.status === 'PENDING').map((s: any) => s.stepNo));
    const stageSteps = req.steps.filter((s: any) => s.stepNo === currentStageNo && s.status === 'PENDING');
    const myStep = stageSteps.find((s: any) => s.approverId === dto.actorId);
    if (!myStep) throw new BadRequestException('not current approver');
    const siblingIds = stageSteps.filter((s: any) => s.id !== myStep.id).map((s: any) => s.id);
    const nextStepNos = req.steps.filter((s: any) => s.stepNo > currentStageNo).map((s: any) => s.stepNo);
    const nextStageNo = nextStepNos.length ? Math.min(...nextStepNos) : null;

    // 스테이지 내 내 스텝 승인 + 형제(any-of) 자동 처리 공통 로직
    const approveStage = async (tx: any) => {
      await tx.approvalStep.update({ where: { id: myStep.id }, data: { status: 'APPROVED' as any, comment: dto.comment, actedAt: new Date() } });
      if (siblingIds.length) {
        await tx.approvalStep.updateMany({ where: { id: { in: siblingIds } }, data: { status: 'APPROVED' as any, comment: '그룹 내 타 결재자 승인으로 자동 처리', actedAt: new Date() } });
      }
      await tx.event.create({ data: { subjectType: 'ApprovalStep', subjectId: myStep.id, activity: 'ApprovalStepApproved', userId: dto.actorId, attrs: { requestId: id, stepNo: currentStageNo, anyOf: stageSteps.length > 1 } } });
    };

    if (nextStageNo != null) {
      await this.prisma.$transaction(async (tx) => {
        await approveStage(tx);
        const nextApprovers = req.steps.filter((s: any) => s.stepNo === nextStageNo);
        await (tx as any).approvalRequest.update({ where: { id }, data: { approverId: nextApprovers[0].approverId } });
        for (const na of nextApprovers) {
          await (tx as any).notification.create({ data: { userId: na.approverId, type: 'ApprovalRequested', subjectType: req.subjectType, subjectId: req.subjectId, payload: { requestId: id, requestedById: req.requestedById } } });
        }
        await (tx as any).event.create({ data: { subjectType: req.subjectType, subjectId: req.subjectId, activity: 'ApprovalRequested', userId: dto.actorId, attrs: { requestId: id, nextStepNo: nextStageNo } } });
      });
      return await this.prisma.approvalRequest.findUnique({ where: { id }, include: { steps: true } });
    }

    // 마지막 스테이지 승인 -> 최종 확정
    return this.prisma.$transaction(async (tx) => {
      await approveStage(tx);
      const updated = await (tx as any).approvalRequest.update({ where: { id }, data: { status: 'APPROVED' } });
      if (updated.subjectType === 'CAR_DISPATCH') {
        await (tx as any).carDispatchRequest.update({ where: { id: updated.subjectId }, data: { status: 'APPROVED' as any } });
      }
      if (updated.subjectType === 'LOGISTICS_DISPATCH') {
        await (tx as any).logisticsDispatchRequest.update({ where: { id: updated.subjectId }, data: { status: 'APPROVED' as any } });
      }
      if (updated.subjectType === 'BUSINESS_TRIP') {
        await (tx as any).businessTripRequest.update({ where: { id: updated.subjectId }, data: { status: 'APPROVED' as any } });
      }
      if (updated.subjectType === 'ATTENDANCE') {
        await (tx as any).attendanceRequest.update({ where: { id: updated.subjectId }, data: { status: 'APPROVED' as any } });
      }
      const engine = new ProcessesController(this.prisma);
      await engine.finalizeTasksLinkedToApprovalRequest(tx as any, id, dto.actorId, dto.comment);
      if (updated.subjectType === 'INSTRUCTION_MILESTONE') {
        const exec = new ExecInstructionsController(this.prisma);
        await exec.finalizeMilestoneApproval(tx as any, id, 'APPROVED', dto.actorId, dto.comment);
      }
      await (tx as any).event.create({ data: { subjectType: updated.subjectType, subjectId: updated.subjectId, activity: 'ApprovalGranted', userId: dto.actorId, attrs: { requestId: id } } });
      await (tx as any).notification.create({ data: { userId: updated.requestedById, type: 'ApprovalGranted', subjectType: updated.subjectType, subjectId: updated.subjectId, payload: { requestId: id } } });
      return updated;
    });
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: ActApprovalDto) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id }, include: { steps: { orderBy: { stepNo: 'asc' } } } });
    if (!req) throw new BadRequestException('request not found');

    if (!req.steps || req.steps.length === 0) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await (tx as any).approvalRequest.update({ where: { id }, data: { status: 'REJECTED' } });
        if (updated.subjectType === 'CAR_DISPATCH') {
          await (tx as any).carDispatchRequest.update({ where: { id: updated.subjectId }, data: { status: 'REJECTED' as any } });
        }
        if (updated.subjectType === 'LOGISTICS_DISPATCH') {
          await (tx as any).logisticsDispatchRequest.update({ where: { id: updated.subjectId }, data: { status: 'REJECTED' as any } });
        }
        if (updated.subjectType === 'BUSINESS_TRIP') {
          await (tx as any).businessTripRequest.update({ where: { id: updated.subjectId }, data: { status: 'REJECTED' as any } });
        }
        if (updated.subjectType === 'ATTENDANCE') {
          await (tx as any).attendanceRequest.update({ where: { id: updated.subjectId }, data: { status: 'REJECTED' as any } });
        }
        const engine = new ProcessesController(this.prisma);
        await engine.finalizeTasksLinkedToApprovalRequest(tx as any, id, dto.actorId, dto.comment);
        if (updated.subjectType === 'INSTRUCTION_MILESTONE') {
          const exec = new ExecInstructionsController(this.prisma);
          await exec.finalizeMilestoneApproval(tx as any, id, 'REJECTED', dto.actorId, dto.comment);
        }
        await (tx as any).event.create({ data: { subjectType: updated.subjectType, subjectId: updated.subjectId, activity: 'ApprovalRejected', userId: dto.actorId, attrs: { requestId: id, reason: dto.comment } } });
        await (tx as any).notification.create({ data: { userId: updated.requestedById, type: 'ApprovalRejected', subjectType: updated.subjectType, subjectId: updated.subjectId, payload: { requestId: id, reason: dto.comment } } });
        return updated;
      });
    }

    const pending = req.steps.find((s: any) => s.status === 'PENDING');
    if (!pending) {
      // 이미 반려된 스텝 있으면 subject 상태 동기화
      const anyRejected = req.steps.some((s: any) => s.status === 'REJECTED');
      if (anyRejected && req.status !== 'REJECTED') {
        await this.prisma.$transaction(async (tx) => {
          await (tx as any).approvalRequest.update({ where: { id }, data: { status: 'REJECTED' } });
          if (req.subjectType === 'ATTENDANCE') {
            await (tx as any).attendanceRequest.update({ where: { id: req.subjectId }, data: { status: 'REJECTED' as any } });
          }
          if (req.subjectType === 'CAR_DISPATCH') {
            await (tx as any).carDispatchRequest.update({ where: { id: req.subjectId }, data: { status: 'REJECTED' as any } });
          }
          if (req.subjectType === 'LOGISTICS_DISPATCH') {
            await (tx as any).logisticsDispatchRequest.update({ where: { id: req.subjectId }, data: { status: 'REJECTED' as any } });
          }
          if (req.subjectType === 'BUSINESS_TRIP') {
            await (tx as any).businessTripRequest.update({ where: { id: req.subjectId }, data: { status: 'REJECTED' as any } });
          }
        });
      }
      return req;
    }
    // 현재 스테이지(가장 낮은 PENDING stepNo)의 결재자 중 한 명이라도 반려하면 전체 반려
    const rejectStageNo = Math.min(...req.steps.filter((s: any) => s.status === 'PENDING').map((s: any) => s.stepNo));
    const myRejectStep = req.steps.find((s: any) => s.stepNo === rejectStageNo && s.status === 'PENDING' && s.approverId === dto.actorId);
    if (!myRejectStep) throw new BadRequestException('not current approver');

    return this.prisma.$transaction(async (tx) => {
      await (tx as any).approvalStep.update({ where: { id: myRejectStep.id }, data: { status: 'REJECTED' as any, comment: dto.comment, actedAt: new Date() } });
      const updated = await (tx as any).approvalRequest.update({ where: { id }, data: { status: 'REJECTED' } });
      if (updated.subjectType === 'CAR_DISPATCH') {
        await (tx as any).carDispatchRequest.update({ where: { id: updated.subjectId }, data: { status: 'REJECTED' as any } });
      }
      if (updated.subjectType === 'LOGISTICS_DISPATCH') {
        await (tx as any).logisticsDispatchRequest.update({ where: { id: updated.subjectId }, data: { status: 'REJECTED' as any } });
      }
      if (updated.subjectType === 'BUSINESS_TRIP') {
        await (tx as any).businessTripRequest.update({ where: { id: updated.subjectId }, data: { status: 'REJECTED' as any } });
      }
      if (updated.subjectType === 'ATTENDANCE') {
        await (tx as any).attendanceRequest.update({ where: { id: updated.subjectId }, data: { status: 'REJECTED' as any } });
      }
      const engine = new ProcessesController(this.prisma);
      await engine.finalizeTasksLinkedToApprovalRequest(tx as any, id, dto.actorId, dto.comment);
      await (tx as any).event.create({ data: { subjectType: updated.subjectType, subjectId: updated.subjectId, activity: 'ApprovalRejected', userId: dto.actorId, attrs: { requestId: id, stepNo: pending.stepNo, reason: dto.comment } } });
      await (tx as any).notification.create({ data: { userId: updated.requestedById, type: 'ApprovalRejected', subjectType: updated.subjectType, subjectId: updated.subjectId, payload: { requestId: id, reason: dto.comment } } });
      return updated;
    });
  }

  @Post('fix-inconsistent')
  async fixInconsistent() {
    // 모든 스텝이 승인/반려인데 subject가 PENDING인 케이스 수정
    const approvals = await this.prisma.approvalRequest.findMany({
      where: { status: 'PENDING' },
      include: { steps: true },
    });

    let fixed = 0;
    for (const approval of approvals) {
      const steps = approval.steps || [];
      if (steps.length === 0) continue;

      const allApproved = steps.every((s: any) => s.status === 'APPROVED');
      const anyRejected = steps.some((s: any) => s.status === 'REJECTED');

      if (allApproved) {
        await this.prisma.$transaction(async (tx) => {
          await (tx as any).approvalRequest.update({ where: { id: approval.id }, data: { status: 'APPROVED' } });
          if (approval.subjectType === 'ATTENDANCE') {
            await (tx as any).attendanceRequest.update({ where: { id: approval.subjectId }, data: { status: 'APPROVED' as any } });
          }
          if (approval.subjectType === 'CAR_DISPATCH') {
            await (tx as any).carDispatchRequest.update({ where: { id: approval.subjectId }, data: { status: 'APPROVED' as any } });
          }
          if (approval.subjectType === 'LOGISTICS_DISPATCH') {
            await (tx as any).logisticsDispatchRequest.update({ where: { id: approval.subjectId }, data: { status: 'APPROVED' as any } });
          }
          if (approval.subjectType === 'BUSINESS_TRIP') {
            await (tx as any).businessTripRequest.update({ where: { id: approval.subjectId }, data: { status: 'APPROVED' as any } });
          }
        });
        fixed++;
      } else if (anyRejected) {
        await this.prisma.$transaction(async (tx) => {
          await (tx as any).approvalRequest.update({ where: { id: approval.id }, data: { status: 'REJECTED' } });
          if (approval.subjectType === 'ATTENDANCE') {
            await (tx as any).attendanceRequest.update({ where: { id: approval.subjectId }, data: { status: 'REJECTED' as any } });
          }
          if (approval.subjectType === 'CAR_DISPATCH') {
            await (tx as any).carDispatchRequest.update({ where: { id: approval.subjectId }, data: { status: 'REJECTED' as any } });
          }
          if (approval.subjectType === 'LOGISTICS_DISPATCH') {
            await (tx as any).logisticsDispatchRequest.update({ where: { id: approval.subjectId }, data: { status: 'REJECTED' as any } });
          }
          if (approval.subjectType === 'BUSINESS_TRIP') {
            await (tx as any).businessTripRequest.update({ where: { id: approval.subjectId }, data: { status: 'REJECTED' as any } });
          }
        });
        fixed++;
      }
    }

    return { fixed, total: approvals.length };
  }
}
