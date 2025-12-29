import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

interface ProcessTaskTemplateDto {
  id?: string;
  name: string;
  description?: string;
  taskType: 'COOPERATION' | 'WORKLOG' | 'APPROVAL' | 'TASK';
  orderHint?: number;
   stageLabel?: string;
  predecessorIds?: string;
  assigneeType?: 'USER' | 'ORG_UNIT' | 'ROLE';
  assigneeUserId?: string;
  assigneeOrgUnitId?: string;
  assigneeRoleCode?: string;
  deadlineOffsetDays?: number;
}

interface ProcessTemplateDto {
  id?: string;
  title: string;
  description?: string;
  type: 'RECURRING' | 'PROJECT';
  ownerId: string;
  visibility: 'PUBLIC' | 'ORG_UNIT' | 'PRIVATE';
  orgUnitId?: string;
  recurrenceType?: string;
  recurrenceDetail?: string;
  resultInputRequired?: boolean;
  expectedDurationDays?: number;
  expectedCompletionCriteria?: string;
  allowExtendDeadline?: boolean;
  status?: string;
  tasks: ProcessTaskTemplateDto[];
}

export function ProcessTemplates() {
  const nav = useNavigate();
  const [items, setItems] = useState<ProcessTemplateDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProcessTemplateDto | null>(null);
  const [loading, setLoading] = useState(false);
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [users, setUsers] = useState<Array<{ id: string; name: string; orgName?: string }>>([]);
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [itemsMaster, setItemsMaster] = useState<Array<{ code: string; name: string }>>([]);
  const [moldsMaster, setMoldsMaster] = useState<Array<{ code: string; name: string }>>([]);
  const [carModelsMaster, setCarModelsMaster] = useState<Array<{ code: string; name: string }>>([]);

  useEffect(() => {
    loadList();
  }, []);

  async function loadList() {
    setLoading(true);
    try {
      const res = await apiJson<ProcessTemplateDto[]>(`/api/process-templates`);
      setItems(res || []);
    } finally {
      setLoading(false);
    }
  }
  

  function newTemplate() {
    if (!userId) {
      alert('로그인이 필요합니다.');
      return;
    }
    const t: ProcessTemplateDto = {
      title: '',
      description: '',
      type: 'PROJECT',
      ownerId: userId,
      visibility: 'PUBLIC',
      recurrenceType: '',
      recurrenceDetail: '',
      resultInputRequired: false,
      expectedDurationDays: undefined,
      expectedCompletionCriteria: '',
      allowExtendDeadline: true,
      status: 'ACTIVE',
      tasks: [],
    };
    setSelectedId(null);
    setEditing(t);
  }

  function editTemplate(t: ProcessTemplateDto) {
    setSelectedId(t.id || null);
    setEditing({
      ...t,
      tasks: (t.tasks || []).map((x, idx) => ({
        ...x,
        orderHint: x.orderHint ?? idx,
      })),
    });
  }

  function updateTask(idx: number, patch: Partial<ProcessTaskTemplateDto>) {
    if (!editing) return;
    const nextTasks = editing.tasks.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    setEditing({ ...editing, tasks: nextTasks });
  }

  function addTask() {
    if (!editing) return;
    const next: ProcessTaskTemplateDto = {
      name: '',
      taskType: 'TASK',
      orderHint: editing.tasks.length,
    };
    setEditing({ ...editing, tasks: [...editing.tasks, next] });
  }

  function removeTask(idx: number) {
    if (!editing) return;
    const next = editing.tasks.filter((_, i) => i !== idx).map((t, i) => ({ ...t, orderHint: i }));
    setEditing({ ...editing, tasks: next });
  }

  async function save() {
    if (!editing) return;
    if (!editing.title.trim()) {
      alert('업무프로세스 제목을 입력하세요.');
      return;
    }
    const body = {
      ...editing,
      tasks: editing.tasks,
    };
    if (editing.id) {
      await apiJson(`/api/process-templates/${encodeURIComponent(editing.id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    } else {
      const created = await apiJson<ProcessTemplateDto>(`/api/process-templates`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSelectedId(created.id || null);
    }
    await loadList();
    alert('업무 프로세스 템플릿이 저장되었습니다.');
  }

  

  async function removeTemplate(id?: string) {
    if (!id) return;
    if (!confirm('정말 삭제하시겠습니까? 이 프로세스의 단계 정의도 함께 삭제됩니다.')) return;
    await apiJson(`/api/process-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setEditing(null);
    setSelectedId(null);
    await loadList();
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)', gap: 16, alignItems: 'flex-start' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2>프로세스 템플릿 목록</h2>
          <button className="btn btn-primary" onClick={newTemplate}>새 템플릿</button>
        </div>
        {loading && <div>불러오는 중...</div>}
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((it) => (
            <div
              key={it.id}
              onClick={() => editTemplate(it)}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 8,
                cursor: 'pointer',
                background: editing?.id === it.id ? '#eff6ff' : '#ffffff',
              }}
            >
              <div style={{ fontWeight: 600 }}>{it.title}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{it.description}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                유형: {it.type === 'RECURRING' ? '반복' : '프로젝트'} · 공개: {it.visibility}
              </div>
            </div>
          ))}
          {!items.length && !loading && <div style={{ fontSize: 12, color: '#9ca3af' }}>아직 정의된 프로세스 템플릿이 없습니다.</div>}
        </div>
      </div>
      <div>
        {editing ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <h2>업무 프로세스 정의</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn" onClick={() => editing?.id && nav(`/process/start?templateId=${encodeURIComponent(editing.id)}`)} disabled={!editing?.id}>이 템플릿으로 시작</button>
            </div>
            <div>
              <label>업무프로세스 제목</label>
              <input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              />
            </div>
            <div>
              <label>업무프로세스 정의</label>
              <textarea
                value={editing.description || ''}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                rows={3}
              />
            </div>
            <div className="resp-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              <div>
                <label>유형</label>
                <select
                  value={editing.type}
                  onChange={(e) => setEditing({ ...editing, type: e.target.value as any })}
                >
                  <option value="RECURRING">반복성</option>
                  <option value="PROJECT">프로젝트성</option>
                </select>
              </div>
              <div>
                <label>공개 범위</label>
                <select
                  value={editing.visibility}
                  onChange={(e) => setEditing({ ...editing, visibility: e.target.value as any })}
                >
                  <option value="PUBLIC">전체 공개</option>
                  <option value="ORG_UNIT">팀 공개</option>
                  <option value="PRIVATE">개인용</option>
                </select>
              </div>
              <div>
                <label>완료 기한 연장 허용</label>
                <select
                  value={editing.allowExtendDeadline ? 'yes' : 'no'}
                  onChange={(e) => setEditing({ ...editing, allowExtendDeadline: e.target.value === 'yes' })}
                >
                  <option value="yes">예</option>
                  <option value="no">아니오</option>
                </select>
              </div>
            </div>
            {editing.type === 'RECURRING' ? (
              <div className="resp-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                <div>
                  <label>주기</label>
                  <select
                    value={editing.recurrenceType || ''}
                    onChange={(e) => setEditing({ ...editing, recurrenceType: e.target.value })}
                  >
                    <option value="">선택</option>
                    <option value="DAILY">일간</option>
                    <option value="WEEKLY">주간</option>
                    <option value="MONTHLY">월간</option>
                    <option value="QUARTERLY">분기</option>
                    <option value="YEARLY">연간</option>
                  </select>
                </div>
                <div>
                  <label>주기 상세</label>
                  <input
                    placeholder="예: 매월 10일 보고"
                    value={editing.recurrenceDetail || ''}
                    onChange={(e) => setEditing({ ...editing, recurrenceDetail: e.target.value })}
                  />
                </div>
                <div>
                  <label>주기적 결과 입력 필요</label>
                  <select
                    value={editing.resultInputRequired ? 'yes' : 'no'}
                    onChange={(e) => setEditing({ ...editing, resultInputRequired: e.target.value === 'yes' })}
                  >
                    <option value="no">아니오</option>
                    <option value="yes">예</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="resp-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <div>
                  <label>예상 소요 일수</label>
                  <input
                    type="number"
                    value={editing.expectedDurationDays ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, expectedDurationDays: e.target.value ? Number(e.target.value) : undefined })
                    }
                  />
                </div>
                <div>
                  <label>완료 기대 수준</label>
                  <input
                    value={editing.expectedCompletionCriteria || ''}
                    onChange={(e) => setEditing({ ...editing, expectedCompletionCriteria: e.target.value })}
                  />
                </div>
              </div>
            )}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <h3>세부 과제(단계) 정의</h3>
                <button className="btn" onClick={addTask}>과제 추가</button>
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                단계(스테이지)와 선행 과제를 활용해 흐름을 정의합니다. 예: 1단계 안에 1-1, 1-2, 결재 과제를 모두 두고, 2단계 과제의 선행 과제로 1-1/1-2/결재를 모두 지정하면 이들이 전부 완료된 뒤에만 2단계가 시작됩니다.
              </div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, display: 'grid', gap: 8 }}>
                {editing.tasks.map((t, idx) => (
                  <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <b>#{idx + 1}{t.stageLabel ? ` · ${t.stageLabel}` : ''}</b>
                      <button className="btn btn-ghost" onClick={() => removeTask(idx)}>삭제</button>
                    </div>
                    <div className="resp-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                      <div>
                        <label>과제 이름</label>
                        <input
                          value={t.name}
                          onChange={(e) => updateTask(idx, { name: e.target.value })}
                        />
                      </div>
                      <div>
                        <label>과제 타입</label>
                        <select
                          value={t.taskType}
                          onChange={(e) => updateTask(idx, { taskType: e.target.value as any })}
                        >
                          <option value="TASK">내부 태스크</option>
                          <option value="COOPERATION">협조</option>
                          <option value="WORKLOG">업무일지</option>
                          <option value="APPROVAL">결재</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label>설명</label>
                      <textarea
                        value={t.description || ''}
                        onChange={(e) => updateTask(idx, { description: e.target.value })}
                        rows={2}
                      />
                    </div>
                    <div className="resp-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                      <div>
                        <label>단계(스테이지)</label>
                        <input
                          placeholder="예: 1단계, 2단계, 마무리단계"
                          value={t.stageLabel || ''}
                          onChange={(e) => updateTask(idx, { stageLabel: e.target.value })}
                        />
                      </div>
                      
                      <div>
                        <label>선행 과제 IDs</label>
                        <input
                          placeholder="이 과제 전에 반드시 끝나야 하는 과제 id들 (콤마로 구분)"
                          value={t.predecessorIds || ''}
                          onChange={(e) => updateTask(idx, { predecessorIds: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="resp-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                      <div>
                        <label>마감 기한 오프셋(D+)</label>
                        <input
                          type="number"
                          value={t.deadlineOffsetDays ?? ''}
                          onChange={(e) =>
                            updateTask(idx, {
                              deadlineOffsetDays: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                        />
                      </div>
                      <div>
                        <label>정렬 순서</label>
                        <input
                          type="number"
                          value={t.orderHint ?? idx}
                          onChange={(e) => updateTask(idx, { orderHint: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                {!editing.tasks.length && (
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>아직 정의된 과제가 없습니다. "과제 추가" 버튼으로 첫 단계를 만드세요.</div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <button
                className="btn btn-outline"
                disabled={!editing.id}
                onClick={() => removeTemplate(editing.id)}
              >
                템플릿 삭제
              </button>
              <button className="btn btn-primary" onClick={save}>저장</button>
            </div>
          </div>
        ) : (
          <div style={{ color: '#9ca3af', fontSize: 13 }}>왼쪽에서 템플릿을 선택하거나 "새 템플릿"을 눌러 업무 프로세스를 정의하세요.</div>
        )}
      </div>
    </div>
  );
}
