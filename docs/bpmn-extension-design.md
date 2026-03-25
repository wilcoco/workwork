# BPMN 확장 설계안 (v1.0)

> 작성일: 2025-03-25  
> 대상: `processes.controller.ts`, `process-templates.controller.ts`, DB 스키마, 프론트엔드 편집기/뷰어

---

## 1. 현재 구현 현황 요약

### 1.1 구현 완료

| 영역 | 기능 | 파일 |
|------|------|------|
| **노드 타입** | Start, End, Task(WORKLOG/APPROVAL/COOPERATION/TASK), XOR Gateway | `compileBpmn()` |
| **순차 실행** | predecessorIds 기반 chain, READY/NOT_STARTED/COMPLETED 전이 | `start()`, `completeTask()`, `unlockReadyDownstreams()` |
| **XOR 분기** | xorGroupKey/xorCondition + evalCondition(), 초기 및 런타임 자동 선택 | `autoSelectXorAtInit()`, `unlockReadyDownstreams()` |
| **결재 체인** | CHAIN_WAIT → 순차 승인, autoCreateApprovalForTaskInstance() | `start()`, `completeTask()`, `finalizeTasksLinkedToApprovalRequest()` |
| **업무일지 연계** | link-worklog + 완료 처리 | `linkWorklog()`, `completeTask()` |
| **프로세스 제어** | stop/resume/abort, force-complete, rollback, modify | `stop()`, `resume()`, `forceComplete()`, `rollback()`, `modify()` |
| **편집기** | ReactFlow 시각 편집기, 폼 편집기, 미니뷰 | `BpmnEditor.tsx`, `BpmnFormEditor.tsx`, `BpmnMiniView.tsx` |
| **AI 생성** | 매뉴얼 → BPMN, Skill File → BPMN | `aiBpmn()`, `skillFileToBpmn()` |

### 1.2 부분 구현 (DB/UI 존재, 런타임 미완)

| 항목 | 현재 상태 |
|------|----------|
| **AND 게이트웨이** | 편집기에서 노드 추가 가능, `compileBpmn()`에서 `isGateway()`로 인식하지만 **런타임 Fork/Join 로직 없음** |
| **마감/SLA** | `deadlineAt`, `slaHours`, `deadlineOffsetDays` 필드 존재. 프론트엔드에서 overdue 카운트 표시. **자동 알림/에스컬레이션 없음** |
| **스테이지 라벨** | DB + 편집기 필드 존재, **편집기 UI에서 `{false && ...}`로 숨겨짐** |
| **마감 오프셋** | DB 필드 존재, **편집기 UI에서 숨겨짐**, 프로세스 시작 시 자동 계산 없음 |
| **결재자 순번** | DB `approvalUserIds` 존재, **편집기 UI에서 숨겨짐** |

---

## 2. 확장 기능 목록 (우선순위별)

### P0 — 핵심 (실제 운영에 필수)

| # | 기능 | 설명 |
|---|------|------|
| **F1** | AND 게이트웨이 런타임 (Fork/Join) | 병렬 분기 → 동시 활성화 → 전부 완료 후 합류 |
| **F2** | 반려 루프백 (Re-work Loop) | 결재 반려 시 이전 태스크 재활성화 |
| **F3** | 마감/SLA 자동 알림 + 에스컬레이션 | D-N 알림, 초과 시 상위자 에스컬레이션 |

### P1 — 높음 (사용성 및 완성도)

| # | 기능 | 설명 |
|---|------|------|
| **F4** | 숨겨진 편집기 필드 활성화 | stageLabel, deadlineOffsetDays, approvalUserIds UI 복원 |
| **F5** | deadlineOffsetDays 자동 계산 | 프로세스 시작 시 deadlineAt 자동 설정 |
| **F6** | 프로세스 버전 관리 강화 | 템플릿 수정 시 실행 중 인스턴스 영향 방지 |

### P2 — 중기

| # | 기능 | 설명 |
|---|------|------|
| **F7** | 멀티인스턴스 태스크 | 같은 태스크를 N명에게 병렬 배정, 전원/다수 완료 시 진행 |
| **F8** | 서브프로세스 | 템플릿 안에 다른 템플릿 중첩 |
| **F9** | 중간 타이머 이벤트 | "N일 대기 후 진행" 시간 기반 지연 노드 |
| **F10** | 프로세스 변수 / 데이터 오브젝트 | 태스크 간 데이터 전달 |

### P3 — 장기

| # | 기능 | 설명 |
|---|------|------|
| **F11** | 스윔레인 시각화 | 부서/역할별 시각적 구분 |
| **F12** | 바운더리 타이머 이벤트 | 태스크 타임아웃 → 자동 분기 |
| **F13** | 보상(Compensation) 핸들러 | 완료된 태스크 되돌리기 |

---

## 3. P0 상세 설계

### 3.1 F1: AND 게이트웨이 런타임 (Fork/Join)

#### 3.1.1 개념

```
Start → TaskA → AND-Split → [TaskB, TaskC, TaskD 동시] → AND-Join → TaskE → End
```

- **AND-Split (Fork)**: 게이트웨이 이후 모든 분기 태스크를 동시에 READY 전환
- **AND-Join (Sync)**: 게이트웨이로 합류하는 모든 선행 태스크가 COMPLETED/SKIPPED일 때만 후행 태스크 READY 전환

#### 3.1.2 현재 문제

`compileBpmn()`의 `collectUpstreamTasks()`는 게이트웨이 노드를 **투과(pass-through)**하여 upstream task를 수집합니다. 이것은 predecessor 관계를 올바르게 설정하지만, `start()`에서 초기 상태 결정 시 predecessor가 있으면 `NOT_STARTED`로 설정하므로, AND 분기 후 태스크들이 **동시에 READY가 되지 않습니다**.

#### 3.1.3 해결 방안

**A. DB 스키마 변경**

```prisma
model ProcessTaskTemplate {
  // 기존 필드...
  parallelGroupKey    String?   // AND 게이트웨이 ID (fork 후 같은 그룹)
  joinGatewayId       String?   // 합류할 AND 게이트웨이 ID
}
```

**B. `compileBpmn()` 변경**

```
[기존] task 노드만 추출 → predecessor 계산 → XOR 정보 추출
[추가] AND gateway 감지 → parallelGroupKey / joinGatewayId 설정
```

1. AND gateway의 outgoing edge 대상 task들: `parallelGroupKey = gateway.id` 설정
2. AND gateway의 incoming edge 소스 task들의 후행: `joinGatewayId = gateway.id` 설정
3. AND gateway를 predecessorIds에서 올바르게 매핑:
   - Fork 후 태스크들: predecessor는 **AND gateway 이전 태스크** (fork 전 태스크)
   - Join 후 태스크들: predecessor는 **모든 병렬 태스크** (join 전 태스크들)

**C. `start()` 변경**

```typescript
// 기존: predecessor 없으면 READY, 있으면 NOT_STARTED
// 변경: predecessor 중 parallelGroupKey로 그룹된 것은 동일 fork 그룹이면 동시 READY

for (const t of tmpl.tasks) {
  const preds = parsePreds(t.predecessorIds);
  if (preds.length === 0) {
    initialStatus = 'READY';
  } else if (t.parallelGroupKey) {
    // AND fork 후 태스크: fork 전 태스크가 완료되면 동시 READY
    // 초기에는 fork 전 태스크가 predecessor이므로 NOT_STARTED
    initialStatus = 'NOT_STARTED';
  } else {
    initialStatus = 'NOT_STARTED';
  }
}
```

**D. `unlockReadyDownstreams()` 변경**

```typescript
// 기존: 각 downstream 후보마다 allPredecessorsCompleted() 체크
// 추가: AND join 감지

// joinGatewayId가 있는 후행 태스크 → 같은 joinGatewayId를 가진 
// 모든 선행 태스크가 COMPLETED/SKIPPED일 때만 READY 전환

// parallelGroupKey가 같은 태스크들은 하나의 predecessor 완료 시
// 나머지도 동시에 READY (fork 동작)
```

핵심 로직:
```typescript
// fork: 같은 parallelGroupKey 가진 태스크들을 한꺼번에 READY
const forkSiblings = candidates.filter(dt => 
  dt.parallelGroupKey && dt.parallelGroupKey === justCompletedTemplate.parallelGroupKey
);
// 이미 allPredecessorsCompleted()에서 ALL 모드로 체크하므로
// predecessorMode 기본값 'ALL'이 AND join 역할을 자연스럽게 수행

// join: joinGatewayId가 같은 후행 태스크들의 모든 선행이 완료되었는지 체크
// → allPredecessorsCompleted()가 이미 ALL 모드에서 이를 수행
```

**E. 핵심 인사이트: 최소 변경으로 AND 지원**

현재 `allPredecessorsCompleted()`는 `predecessorMode`가 'ANY'가 아닌 경우 **모든 predecessor가 COMPLETED/SKIPPED**인지 확인합니다. 이것은 이미 AND-Join 시맨틱입니다!

따라서 **AND 게이트웨이의 핵심 변경은 `compileBpmn()`에서 predecessor 관계를 올바르게 설정하는 것**입니다:

```
AND-Split 후 태스크들의 predecessor = Split 이전 태스크 (NOT AND 게이트웨이 자체)
AND-Join 후 태스크들의 predecessor = 모든 병렬 태스크들 (predecessorMode = 'ALL')
```

현재 `collectUpstreamTasks()`가 이미 게이트웨이를 투과하여 upstream task를 수집하므로, **AND-Split 후 태스크들은 이미 같은 predecessor를 가집니다**. 문제는:

1. 같은 predecessor를 가진 태스크들이 동시에 READY가 되는가? → **YES** (predecessor가 완료되면 `unlockReadyDownstreams()`가 모든 downstream을 체크)
2. AND-Join 후 태스크의 predecessor가 모든 병렬 태스크를 포함하는가? → **YES** (`collectUpstreamTasks()`가 AND gateway를 투과하여 모든 upstream task를 수집)

**결론: 현재 코드는 이미 AND 게이트웨이를 거의 올바르게 처리합니다!**

다만 확인/수정이 필요한 부분:
1. `unlockReadyDownstreams()`에서 XOR 그룹이 아닌 태스크들은 `noGroup`으로 분류되어 개별 READY 전환 → OK
2. `compileBpmn()`에서 AND gateway가 `isGateway()`로 인식되어 투과 → OK
3. XOR 전용 로직(`xorGroupKey`, `xorCondition`)이 AND에 잘못 적용되지 않는지 확인 필요

**실제 필요한 변경:**
- `compileBpmn()`에서 AND gateway를 명시적으로 처리하여 `predecessorMode`가 XOR 때만 'ANY'로 설정되는지 확인 (현재 OK)
- AND fork/join이 편집기에서 시각적으로 올바르게 표현되는지 확인
- AND gateway 관련 테스트 케이스 추가

#### 3.1.4 프론트엔드 변경

`BpmnEditor.tsx`, `BpmnMiniView.tsx`:
- AND 게이트웨이 노드의 시각적 차별화 (다이아몬드 + "+" 기호)
- 편집기에서 AND 게이트웨이에 연결된 엣지는 조건(condition) 불필요함을 표시

---

### 3.2 F2: 반려 루프백 (Re-work Loop)

#### 3.2.1 개념

```
작성(TaskA) → 결재(TaskB) →(반려)→ 작성(TaskA 재활성화) → 결재(TaskB) → ...
                            →(승인)→ TaskC
```

#### 3.2.2 현재 한계

- 결재 반려 시 `finalizeTasksLinkedToApprovalRequest()`가 태스크를 COMPLETED로 처리
- XOR 분기로 다른 경로를 선택할 수 있지만, **같은 태스크를 다시 활성화하는 루프는 불가능**
- `rollback()` API가 있지만, 관리자(EXEC/CEO) 전용이고 수동 호출 필요

#### 3.2.3 해결 방안

**A. DB 스키마 변경**

```prisma
model ProcessTaskTemplate {
  // 기존 필드...
  loopBackTargetId    String?   // 반려 시 돌아갈 태스크 템플릿 ID
  loopBackCondition   String?   // 루프백 조건 (예: "last.approval.status == 'REJECTED'")
  maxLoopCount        Int?      // 무한 루프 방지 (기본: 3)
}

model ProcessTaskInstance {
  // 기존 필드...
  loopCount           Int       @default(0)  // 현재 루프 횟수
}
```

**B. BPMN JSON 확장**

```json
{
  "edges": [
    {
      "id": "e1",
      "source": "approval_task",
      "target": "write_task",
      "condition": "last.approval.status == 'REJECTED'",
      "isLoopBack": true
    }
  ]
}
```

편집기에서 엣지에 `isLoopBack` 플래그를 설정할 수 있도록 UI 추가.

**C. `compileBpmn()` 변경**

```typescript
// 엣지 중 isLoopBack === true인 것을 감지
// source 태스크 → loopBackTargetId = target 태스크
// loopBackCondition = 엣지의 condition
for (const e of bpmn.edges) {
  if (e.isLoopBack) {
    const sourceTask = taskNodes.find(n => n.id === e.source);
    if (sourceTask) {
      sourceTask.loopBackTargetId = e.target;
      sourceTask.loopBackCondition = e.condition || '';
    }
  }
}
```

**D. `completeTask()` / `finalizeTasksLinkedToApprovalRequest()` 변경**

```typescript
// 태스크 완료 후, 루프백 조건 평가
const tmpl = await tx.processTaskTemplate.findUnique({ where: { id: task.taskTemplateId } });
if (tmpl.loopBackTargetId && tmpl.loopBackCondition) {
  const ctx = buildConditionContext(tx, instanceId, task);
  if (this.evalCondition(tmpl.loopBackCondition, ctx)) {
    // 루프 카운트 체크
    if (task.loopCount < (tmpl.maxLoopCount || 3)) {
      // 타겟 태스크 재활성화
      await this.reactivateTask(tx, instanceId, tmpl.loopBackTargetId, task.loopCount + 1);
      // 현재 태스크는 COMPLETED로 유지하되, 후행 태스크 unlock은 하지 않음
      return updated; // early return, skip unlockReadyDownstreams
    }
    // 최대 루프 초과 → 에스컬레이션 알림
    await this.notifyLoopExceeded(tx, instanceId, task);
  }
}
```

```typescript
private async reactivateTask(tx, instanceId, targetTemplateId, newLoopCount) {
  // 타겟 태스크 인스턴스를 READY로 전환 + loopCount 업데이트
  const targets = await tx.processTaskInstance.findMany({
    where: { instanceId, taskTemplateId: targetTemplateId, status: { in: ['COMPLETED', 'SKIPPED'] } },
  });
  for (const t of targets) {
    await tx.processTaskInstance.update({
      where: { id: t.id },
      data: { 
        status: 'READY', 
        actualStartAt: null, 
        actualEndAt: null,
        worklogId: null,
        loopCount: newLoopCount,
      },
    });
    // 알림: 재작업 필요
    if (t.assigneeId) {
      await tx.notification.create({
        data: {
          userId: t.assigneeId,
          type: 'ProcessTaskReworkRequired',
          subjectType: 'PROCESS',
          subjectId: instanceId,
          payload: { taskId: t.id, taskName: t.name, loopCount: newLoopCount },
        },
      });
    }
  }
}
```

#### 3.2.4 프론트엔드 변경

**편집기:**
- 엣지 속성에 "루프백(반려→재작업)" 토글 추가
- 루프백 엣지를 점선 또는 빨간색으로 시각적 구분
- 최대 루프 횟수 설정 필드

**프로세스 상세:**
- 태스크에 `loopCount` 표시 (예: "재작업 2/3회차")
- 루프백 히스토리 타임라인 표시

---

### 3.3 F3: 마감/SLA 자동 알림 + 에스컬레이션

#### 3.3.1 개념

```
태스크 생성 → [D-3 알림] → [D-1 알림] → [마감 초과] → [D+1 상위자 알림] → [D+3 임원 알림]
```

#### 3.3.2 현재 상태

- `ProcessTaskInstance.deadlineAt` 필드 존재
- `ProcessTaskTemplate.slaHours`, `deadlineOffsetDays` 필드 존재
- 프론트엔드에서 overdue 카운트 표시
- **자동 알림/에스컬레이션 인프라 없음**
- **크론/스케줄러 없음** (periodic-alarms.controller.ts에 @Cron 관련 코드 있음)

#### 3.3.3 해결 방안

**A. DB 스키마 변경**

```prisma
model ProcessDeadlineAlert {
  id              String    @id @default(cuid())
  taskInstanceId  String
  taskInstance    ProcessTaskInstance @relation(fields: [taskInstanceId], references: [id])
  alertType       String    // 'APPROACHING' | 'OVERDUE' | 'ESCALATION'
  alertLevel      Int       @default(0) // 0=담당자, 1=팀장, 2=임원
  scheduledAt     DateTime  // 알림 예정 시각
  sentAt          DateTime? // 실제 발송 시각 (null이면 미발송)
  recipientId     String
  createdAt       DateTime  @default(now())
}

model ProcessTaskInstance {
  // 기존 필드...
  deadlineAlerts  ProcessDeadlineAlert[]
}
```

**B. 알림 스케줄 생성 (`start()` 및 `unlockReadyDownstreams()` 변경)**

태스크가 READY 상태가 될 때 deadlineAt이 있으면 자동으로 알림 스케줄 생성:

```typescript
private async scheduleDeadlineAlerts(tx, taskInstance) {
  if (!taskInstance.deadlineAt) return;
  const deadline = new Date(taskInstance.deadlineAt);
  const assigneeId = taskInstance.assigneeId;
  if (!assigneeId) return;

  const alerts = [
    // D-3: 담당자 접근 알림
    { alertType: 'APPROACHING', alertLevel: 0, scheduledAt: addDays(deadline, -3), recipientId: assigneeId },
    // D-1: 담당자 긴급 알림
    { alertType: 'APPROACHING', alertLevel: 0, scheduledAt: addDays(deadline, -1), recipientId: assigneeId },
    // D+0: 마감 초과 알림 (담당자)
    { alertType: 'OVERDUE', alertLevel: 0, scheduledAt: deadline, recipientId: assigneeId },
    // D+1: 팀장 에스컬레이션
    { alertType: 'ESCALATION', alertLevel: 1, scheduledAt: addDays(deadline, 1), recipientId: '{{MANAGER}}' },
    // D+3: 임원 에스컬레이션
    { alertType: 'ESCALATION', alertLevel: 2, scheduledAt: addDays(deadline, 3), recipientId: '{{EXEC}}' },
  ];

  for (const a of alerts) {
    // 과거 시각은 건너뜀
    if (a.scheduledAt.getTime() < Date.now()) continue;
    // {{MANAGER}}, {{EXEC}} 같은 플레이스홀더는 실제 발송 시 해소
    await tx.processDeadlineAlert.create({
      data: { taskInstanceId: taskInstance.id, ...a },
    });
  }
}
```

**C. 크론 서비스 (신규)**

```typescript
// process-deadline.service.ts
@Injectable()
export class ProcessDeadlineService {
  @Cron('0 */15 * * * *') // 매 15분
  async checkDeadlines() {
    const now = new Date();
    const pending = await this.prisma.processDeadlineAlert.findMany({
      where: { sentAt: null, scheduledAt: { lte: now } },
      include: { taskInstance: { include: { instance: true } } },
    });

    for (const alert of pending) {
      const task = alert.taskInstance;
      // 이미 완료된 태스크면 skip
      if (['COMPLETED', 'SKIPPED'].includes(task.status)) {
        await this.prisma.processDeadlineAlert.update({
          where: { id: alert.id }, data: { sentAt: now },
        });
        continue;
      }

      // recipientId 해소
      let recipientId = alert.recipientId;
      if (recipientId === '{{MANAGER}}') {
        recipientId = await this.resolveManager(task.assigneeId);
      } else if (recipientId === '{{EXEC}}') {
        recipientId = await this.resolveExec(task.assigneeId);
      }

      if (recipientId) {
        await this.prisma.notification.create({
          data: {
            userId: recipientId,
            type: `ProcessTask${alert.alertType}`,
            subjectType: 'PROCESS',
            subjectId: task.instanceId,
            payload: {
              taskId: task.id,
              taskName: task.name,
              deadlineAt: task.deadlineAt,
              alertLevel: alert.alertLevel,
            },
          },
        });
      }

      await this.prisma.processDeadlineAlert.update({
        where: { id: alert.id }, data: { sentAt: now },
      });
    }
  }
}
```

**D. NestJS ScheduleModule 등록**

```typescript
// app.module.ts
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot(), ...],
  providers: [ProcessDeadlineService, ...],
})
```

#### 3.3.4 프론트엔드 변경

**프로세스 상세 페이지:**
- 마감 임박 태스크 시각적 강조 (노랑 = D-3, 빨강 = 초과)
- 에스컬레이션 히스토리 표시

**편집기:**
- `deadlineOffsetDays` 필드 활성화 (현재 `{false && ...}`)
- SLA 시간 설정 필드 활성화

---

## 4. P1 상세 설계

### 4.1 F4: 숨겨진 편집기 필드 활성화

**현재 상태** (`BpmnEditor.tsx`, `BpmnFormEditor.tsx`):
```tsx
{false && (<label>스테이지<input ... /></label>)}
{false && (<label>마감 오프셋(D+)<input ... /></label>)}
{false && (<label>담당자 순번(쉼표로 ID 나열)<input ... /></label>)}
```

**변경:** `{false && ...}` 제거하여 UI 복원

- **스테이지 라벨**: 태스크를 단계별로 그룹핑 (예: "기획", "설계", "검증")
- **마감 오프셋(D+)**: 프로세스 시작일로부터 N일 후 마감
- **결재자 순번**: 편집기에서 직접 결재 체인 설정

### 4.2 F5: deadlineOffsetDays 자동 계산

**`start()` 변경:**

```typescript
// 태스크 생성 시 deadlineOffsetDays → deadlineAt 자동 계산
const deadlineAt = plan.deadlineAt 
  || (t.deadlineOffsetDays ? addDays(now, t.deadlineOffsetDays) : undefined);
```

### 4.3 F6: 프로세스 버전 관리 강화

현재: 템플릿 수정 시 이미 실행 중인 인스턴스도 영향 받을 수 있음

**방안:** 
- `ProcessInstance`에 `templateVersion` 필드 추가
- 인스턴스 생성 시 현재 템플릿 버전 스냅샷 저장
- 템플릿 수정(update) 시 version 자동 증가
- 실행 중 인스턴스는 생성 시점의 태스크 구조 유지 (이미 taskInstance로 복사되므로 대부분 OK)

---

## 5. 구현 순서 제안

### Phase 1: AND 게이트웨이 + 편집기 개선 (F1 + F4)

1. `compileBpmn()` AND 게이트웨이 처리 검증 및 보강
2. 편집기 숨긴 필드 활성화 (stageLabel, deadlineOffsetDays, approvalUserIds)
3. AND 게이트웨이 노드 시각적 차별화
4. AND 시나리오 E2E 테스트

### Phase 2: 마감 자동화 (F3 + F5)

1. DB 스키마: `ProcessDeadlineAlert` 모델 추가
2. `ScheduleModule` + `ProcessDeadlineService` 크론 서비스
3. 태스크 READY 시 알림 스케줄 자동 생성
4. `deadlineOffsetDays` → `deadlineAt` 자동 계산
5. 프론트엔드: 마감 임박/초과 시각 표시

### Phase 3: 반려 루프백 (F2)

1. DB 스키마: `loopBackTargetId`, `loopBackCondition`, `maxLoopCount`, `loopCount`
2. BPMN JSON `isLoopBack` 엣지 확장
3. `compileBpmn()` 루프백 엣지 처리
4. `completeTask()` / `finalizeTasksLinkedToApprovalRequest()` 루프백 로직
5. 편집기: 루프백 엣지 UI
6. 프론트엔드: 루프 카운트 표시

### Phase 4: 버전 관리 + 중기 기능 (F6 + F7~F10)

---

## 6. 영향 범위 요약

| 파일 | F1 | F2 | F3 | F4 | F5 |
|------|:--:|:--:|:--:|:--:|:--:|
| `schema.prisma` | - | O | O | - | - |
| `process-templates.controller.ts` | O | O | - | - | - |
| `processes.controller.ts` | O | O | O | - | O |
| `process-deadline.service.ts` (신규) | - | - | O | - | - |
| `app.module.ts` | - | - | O | - | - |
| `BpmnEditor.tsx` | O | O | - | O | - |
| `BpmnFormEditor.tsx` | O | O | - | O | - |
| `BpmnMiniView.tsx` | O | - | - | - | - |
| `ProcessInstanceDetail.tsx` | - | O | O | - | - |
| `work-manuals.controller.ts` (AI 프롬프트) | O | O | - | - | - |

---

## 7. 테스트 시나리오

### F1: AND 게이트웨이
- 시나리오 A: Start → AND-Split → [B, C] → AND-Join → D → End
  - B, C가 동시에 READY 확인
  - B만 완료 → D는 NOT_STARTED 유지
  - C도 완료 → D가 READY 전환 확인

### F2: 반려 루프백
- 시나리오 A: 작성 → 결재 → (반려) → 작성 재활성화 → 결재 → (승인) → 완료
  - 반려 시 작성 태스크 READY 전환 + loopCount 증가 확인
  - 최대 루프 초과 시 에스컬레이션 알림 확인

### F3: 마감 알림
- 시나리오 A: deadlineAt = now + 2일 태스크 생성
  - D-3 알림은 과거이므로 skip
  - D-1 알림 스케줄 생성 확인
  - 크론 실행 시 알림 발송 확인
  - 태스크 완료 후 미발송 알림 skip 확인

---

## 8. 마이그레이션 호환성

- **F1**: DB 변경 없이 가능 (compileBpmn 로직만 보강). 기존 인스턴스 영향 없음
- **F2**: 신규 필드 추가 (nullable). 기존 인스턴스/템플릿은 loopBack 없이 동작
- **F3**: 신규 모델 추가. 기존 인스턴스에는 알림 스케줄 없음 (새로 시작하는 인스턴스부터 적용)
- **F4**: 프론트엔드만 변경. 기존 데이터 영향 없음
- **F5**: 기존 deadlineAt이 null인 태스크에 자동 계산 적용 (새 인스턴스부터)

---

## 9. AI BPMN 생성 프롬프트/스키마 확장

> **핵심 원칙**: 확장 기능을 엔진만 지원하는 것으로는 불충분합니다.
> 매뉴얼/Skill File에서 AI가 BPMN을 생성할 때, 확장 기능을 **자동으로 활용**해야 합니다.

### 9.1 영향 받는 엔드포인트

| 엔드포인트 | 파일 | 용도 |
|-----------|------|------|
| `POST :id/ai/bpmn` | `work-manuals.controller.ts:482` | 매뉴얼 → BPMN |
| `POST :id/skill-file/to-bpmn` | `work-manuals.controller.ts:1411` | Skill File → BPMN |

### 9.2 현재 AI 출력 스키마 vs 확장 스키마

#### 현재 (변경 전)

```
node: { id, type, name, taskType, description, assigneeHint, emailTo/Cc/Subject/Body Template }
edge: { id, source, target, condition }
```

#### 확장 후 (변경 후)

```
node: {
  id, type, name, taskType, description, assigneeHint,
  + stageLabel,              // F4: 단계 그룹 (예: "기획", "설계", "검증")
  + deadlineOffsetDays,      // F5: 프로세스 시작일 기준 D+N 마감
  + slaHours,                // F3: SLA 시간 (예: 48)
  emailTo/Cc/Subject/Body Template
}
edge: {
  id, source, target, condition,
  + isLoopBack               // F2: 반려→재작업 루프 엣지
}
```

### 9.3 AI 시스템 프롬프트 변경 — aiBpmn()

아래는 확장 후 시스템 프롬프트 전문입니다.

```
당신은 업무 메뉴얼을 읽고 BPMN 초안(JSON)만 출력하는 도우미입니다.
반드시 JSON만 출력하세요. 마크다운 코드펜스(``)를 사용하지 마세요.

출력 JSON 스키마:
{
  "title": string,
  "bpmnJson": {
    "nodes": Array<{
      id: string,
      type: "start"|"end"|"task"|"gateway_xor"|"gateway_parallel",
      name: string,
      taskType?: "WORKLOG"|"COOPERATION"|"APPROVAL",
      description?: string,
      assigneeHint?: string,
      stageLabel?: string,
      deadlineOffsetDays?: number,
      slaHours?: number,
      emailToTemplate?: string,
      emailCcTemplate?: string,
      emailSubjectTemplate?: string,
      emailBodyTemplate?: string
    }>,
    "edges": Array<{
      id: string,
      source: string,
      target: string,
      condition?: string,
      isLoopBack?: boolean
    }>
  }
}

핵심 규칙:
- nodes에는 start와 end를 반드시 포함
- type=task 노드만 실제 업무 단계(메뉴얼의 STEP에 해당)
- 입력에 없는 STEP(업무 단계)는 새로 만들어내지 마세요. 단, start/end/gateway는 필요하면 생성해도 됩니다.
- 최대 20개의 task 노드까지만 생성
- description은 사람이 읽기 좋은 HTML로 정리하세요(<ul><li>...</li></ul> 등)
- 각 task 노드는 taskType을 반드시 포함하세요.

taskType 규칙:
- 기본: WORKLOG (업무일지로 완료 근거 확보)
- 결재/결정 단계: APPROVAL
- 타팀/타인 요청 단계: COOPERATION
- TASK는 사용하지 마세요 (WORKLOG로 대체)

▶ 병렬 실행 (AND 게이트웨이) 규칙:
- 서로 독립적으로 동시 진행 가능한 태스크 그룹이 있으면 gateway_parallel 노드를 사용하세요.
- AND-Split: gateway_parallel에서 여러 task로 분기하는 edge를 만드세요 (조건 없음)
- AND-Join: 병렬 태스크들이 모두 끝나야 하는 합류점에 다시 gateway_parallel 노드를 두고,
  각 병렬 task → join gateway → 후행 task로 edge를 연결하세요.
- 예시: TaskA → AND-Split → [TaskB, TaskC] → AND-Join → TaskD
- 순차 실행이 기본이고, 병렬이 명확할 때만 사용하세요.

▶ 분기 (XOR 게이트웨이) 규칙:
- 조건에 따라 하나의 경로만 선택하는 경우 gateway_xor를 사용하세요.
- edge.condition에 런타임 조건식을 넣으세요.
- 연산자: ==, !=, &&, ||
- 좌변: last.approval.status, startedBy.role, itemCode, moldCode, carModelCode, initiativeId
- 우변: 문자열('APPROVED'), 숫자, true/false, null

▶ 반려 루프백 규칙:
- 결재(APPROVAL) 태스크 뒤에 반려 시 이전 작성 태스크로 돌아가야 하는 경우,
  결재 태스크 → 작성 태스크로 향하는 edge를 추가하고 isLoopBack: true로 설정하세요.
- 이 edge에는 condition: "last.approval.status == 'REJECTED'" 를 반드시 포함하세요.
- 루프백은 결재 반려 패턴에서만 사용하세요.
- 예시: 작성(TaskA) → 결재(TaskB) → [승인: TaskC, 반려(isLoopBack): TaskA]

▶ stageLabel 규칙:
- 프로세스가 논리적으로 여러 단계(phase)로 나뉘면, 각 task에 stageLabel을 설정하세요.
- 같은 단계에 속하는 task들은 동일한 stageLabel을 사용하세요.
- 예: "1. 기획", "2. 설계", "3. 검증", "4. 승인"
- 단계 구분이 불명확하면 생략 가능합니다.

▶ deadlineOffsetDays / slaHours 규칙:
- 메뉴얼에 기한(N일 이내, N시간 이내 등)이 명시되어 있으면 설정하세요.
- deadlineOffsetDays: 프로세스 시작일로부터 D+N일 후 마감 (예: 7 = 시작 후 7일)
- slaHours: 태스크 시작 후 N시간 내 완료 기대 (예: 48)
- 기한 언급이 없으면 생략하세요.

메뉴얼에 다음과 같은 표준 포맷이 있으면 그 구조를 우선 파싱하세요:
- "### STEP S1 | 단계명" 형태의 블록을 하나의 task 노드로 생성
- 각 STEP의 "- taskType: WORKLOG|APPROVAL|COOPERATION" 값을 taskType에 매핑
- STEP 블록의 목적/입력/산출물/업무일지/완료조건은 description에 요약(HTML)
```

### 9.4 AI Tool/JSON 스키마 변경 — bpmnToolSchema

```typescript
const bpmnToolSchema = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' },
    bpmnJson: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['start', 'end', 'task', 'gateway_xor', 'gateway_parallel'] },
              name: { type: 'string' },
              taskType: { type: 'string', enum: ['WORKLOG', 'COOPERATION', 'APPROVAL'] },
              description: { type: 'string' },
              assigneeHint: { type: 'string' },
              stageLabel: { type: 'string' },
              deadlineOffsetDays: { type: 'number' },
              slaHours: { type: 'number' },
              emailToTemplate: { type: 'string' },
              emailCcTemplate: { type: 'string' },
              emailSubjectTemplate: { type: 'string' },
              emailBodyTemplate: { type: 'string' },
            },
            required: ['id', 'type', 'name'],
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              source: { type: 'string' },
              target: { type: 'string' },
              condition: { type: 'string' },
              isLoopBack: { type: 'boolean' },
            },
            required: ['id', 'source', 'target'],
          },
        },
      },
      required: ['nodes', 'edges'],
    },
  },
  required: ['title', 'bpmnJson'],
};
```

### 9.5 AI 시스템 프롬프트 변경 — skillFileToBpmn()

기존 프롬프트에 다음 규칙 추가 (aiBpmn과 동일한 확장):

```
추가 변환 규칙:
- 병렬 실행: steps 중 서로 독립적인 단계는 gateway_parallel(AND) 노드로 분기/합류
- 반려 루프백: decisions에 "반려 → 재작업" 패턴이 있으면 isLoopBack edge 생성
- stageLabel: steps의 논리적 그룹을 stageLabel로 매핑
- deadlineOffsetDays: steps에 기한 정보가 있으면 D+N으로 매핑
- slaHours: steps에 시간 제한이 있으면 매핑

출력 JSON 스키마:
{
  "title": string,
  "bpmnJson": {
    "nodes": Array<{ id, type, name, taskType?, description?, assigneeHint?,
                      stageLabel?, deadlineOffsetDays?, slaHours? }>,
    "edges": Array<{ id, source, target, condition?, isLoopBack? }>
  }
}
```

### 9.6 Normalization 후처리 변경

현재 `aiBpmn()`과 `skillFileToBpmn()` 모두 taskType 정규화만 수행합니다.
확장 후 추가 후처리:

```typescript
// 기존: taskType 정규화
const normalizedNodes = (nodes as any[]).map((n: any) => {
  if (String(n?.type || '') !== 'task') return n;
  let tt = String(n?.taskType || 'WORKLOG').toUpperCase();
  if (tt === 'TASK') tt = 'WORKLOG';
  if (!['WORKLOG', 'APPROVAL', 'COOPERATION'].includes(tt)) tt = 'WORKLOG';
  return { ...n, taskType: tt };
});

// 추가: deadlineOffsetDays, slaHours 정규화
const normalizedNodes = (nodes as any[]).map((n: any) => {
  // ... 기존 taskType 정규화 ...
  // deadlineOffsetDays: 숫자만 허용, 음수/0 제거
  if (n.deadlineOffsetDays != null) {
    const d = Number(n.deadlineOffsetDays);
    n.deadlineOffsetDays = (Number.isFinite(d) && d > 0) ? Math.round(d) : undefined;
  }
  // slaHours: 숫자만 허용, 음수/0 제거
  if (n.slaHours != null) {
    const h = Number(n.slaHours);
    n.slaHours = (Number.isFinite(h) && h > 0) ? Math.round(h) : undefined;
  }
  // stageLabel: 빈 문자열 제거
  if (n.stageLabel != null) {
    n.stageLabel = String(n.stageLabel).trim() || undefined;
  }
  return n;
});

// 추가: isLoopBack 엣지 정규화
const normalizedEdges = (edges as any[]).map((e: any) => {
  if (e.isLoopBack != null) {
    e.isLoopBack = Boolean(e.isLoopBack);
    // isLoopBack이면 condition 필수 체크
    if (e.isLoopBack && !e.condition) {
      e.condition = "last.approval.status == 'REJECTED'";
    }
  }
  return e;
});
```

### 9.7 프론트엔드 편집기 확장

**BpmnEditor.tsx** `toJson()` / `fromJson()` 에 신규 필드 추가:

```typescript
// toJson() - 노드
stageLabel: (n.data as any)?.stageLabel || undefined,
deadlineOffsetDays: (n.data as any)?.deadlineOffsetDays ?? undefined,
slaHours: (n.data as any)?.slaHours ?? undefined,

// toJson() - 엣지
isLoopBack: (e as any).data?.isLoopBack || undefined,

// fromJson() - 노드 data
stageLabel: n.stageLabel || undefined,
deadlineOffsetDays: n.deadlineOffsetDays ?? undefined,
slaHours: n.slaHours ?? undefined,

// fromJson() - 엣지 data
isLoopBack: e.isLoopBack || undefined,
```

**BpmnEditor.tsx** 사이드패널 — task 노드 속성:

```tsx
// 기존 {false && ...} 제거 → 활성화:
<label>스테이지<input value={...stageLabel} onChange={...} /></label>
<label>마감 오프셋(D+)<input type="number" value={...deadlineOffsetDays} /></label>
<label>SLA(시간)<input type="number" value={...slaHours} /></label>
```

**BpmnEditor.tsx** 사이드패널 — 엣지 속성:

```tsx
// 조건(XOR) 아래에 추가:
<label>
  <input type="checkbox" checked={isLoopBack} onChange={...} />
  반려 루프백 (이전 태스크로 되돌리기)
</label>
```

**BpmnEditor.tsx** — 시각적 차별화:

```tsx
// AND 게이트웨이 노드: 다이아몬드 + "+" 기호
// XOR 게이트웨이 노드: 다이아몬드 + "X" 기호
// 루프백 엣지: 점선 + 빨간색
// 마감 있는 태스크: 시계 아이콘 표시
```

**BpmnFormEditor.tsx** 도 동일하게 확장.

### 9.8 createBpmnTemplate (WorkManualExt.tsx) 확장

현재 `createBpmnTemplate()`과 `createModuleIntegration('bpmn_engine')`는
AI 결과의 `bpmnJson`을 그대로 `/api/process-templates` POST로 전달합니다.

확장 후 신규 필드(`stageLabel`, `deadlineOffsetDays`, `slaHours`, `isLoopBack`)가
bpmnJson에 포함되면, `compileBpmn()`이 이를 파싱하여 DB에 저장합니다.
**프론트엔드 변경 불필요** — bpmnJson을 투과 전달하므로.

### 9.9 구현 순서에 AI 프롬프트 변경 반영

| Phase | 기존 계획 | + AI 프롬프트 변경 |
|-------|----------|-----------------|
| **Phase 1** | F1(AND) + F4(숨긴 필드) | + 프롬프트에 AND 게이트웨이 규칙 추가, stageLabel 생성 규칙 추가 |
| **Phase 2** | F3(마감 알림) + F5(마감 자동계산) | + 프롬프트에 deadlineOffsetDays/slaHours 생성 규칙 추가 |
| **Phase 3** | F2(반려 루프백) | + 프롬프트에 isLoopBack 엣지 규칙 추가 |

**각 Phase에서 엔진 변경과 AI 프롬프트 변경을 동시에 배포해야 합니다.**

---

## 10. 전체 영향 범위 최종 정리

| 파일 | F1 | F2 | F3 | F4 | F5 | AI |
|------|:--:|:--:|:--:|:--:|:--:|:--:|
| `schema.prisma` | - | O | O | - | - | - |
| `process-templates.controller.ts` | O | O | - | - | - | - |
| `processes.controller.ts` | O | O | O | - | O | - |
| `process-deadline.service.ts` (신규) | - | - | O | - | - | - |
| `app.module.ts` | - | - | O | - | - | - |
| **`work-manuals.controller.ts`** | **O** | **O** | **O** | - | - | **O** |
| `BpmnEditor.tsx` | O | O | - | O | - | - |
| `BpmnFormEditor.tsx` | O | O | - | O | - | - |
| `BpmnMiniView.tsx` | O | - | - | - | - | - |
| `ProcessInstanceDetail.tsx` | - | O | O | - | - | - |
| `WorkManualExt.tsx` | - | - | - | - | - | - |
