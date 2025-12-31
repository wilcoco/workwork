import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

interface ProcessTaskTemplateDto {
  id?: string;
  name: string;
  taskType: 'COOPERATION' | 'WORKLOG' | 'APPROVAL' | 'TASK';
  stageLabel?: string;
  description?: string;
  assigneeHint?: string;
}
interface ProcessTemplateDto {
  id?: string;
  title: string;
  description?: string;
  type: 'RECURRING' | 'PROJECT';
  tasks: ProcessTaskTemplateDto[];
}

export function ProcessStart() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const initialTemplateId = params?.get('templateId') || '';

  const [templates, setTemplates] = useState<ProcessTemplateDto[]>([]);
  const [tplId, setTplId] = useState('');
  const [loading, setLoading] = useState(false);

  const [startTitle, setStartTitle] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [moldCode, setMoldCode] = useState('');
  const [carModelCode, setCarModelCode] = useState('');

  const [itemsMaster, setItemsMaster] = useState<Array<{ code: string; name: string }>>([]);
  const [moldsMaster, setMoldsMaster] = useState<Array<{ code: string; name: string }>>([]);
  const [carModelsMaster, setCarModelsMaster] = useState<Array<{ code: string; name: string }>>([]);

  const selected = useMemo(() => templates.find(t => t.id === tplId) || null, [templates, tplId]);
  const [users, setUsers] = useState<Array<{ id: string; name: string; orgName?: string }>>([]);
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [plans, setPlans] = useState<Record<string, { plannedStartAt?: string; plannedEndAt?: string; deadlineAt?: string }>>({});
  const [initiativeId, setInitiativeId] = useState('');
  const [myInits, setMyInits] = useState<Array<{ id: string; title: string }>>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await apiJson<ProcessTemplateDto[]>(`/api/process-templates`);
        setTemplates(res || []);
        if (initialTemplateId) setTplId(initialTemplateId);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const im = await apiJson<{ items: Array<{ code: string; name: string }> }>(`/api/masters/items`);
        setItemsMaster(im?.items || []);
      } catch {}
      try {
        const mm = await apiJson<{ items: Array<{ code: string; name: string }> }>(`/api/masters/molds`);
        setMoldsMaster(mm?.items || []);
      } catch {}
      try {
        const cm = await apiJson<{ items: Array<{ code: string; name: string }> }>(`/api/masters/car-models`);
        setCarModelsMaster(cm?.items || []);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const ul = await apiJson<{ items: Array<{ id: string; name: string; orgName?: string }> }>(`/api/users`);
        setUsers(ul?.items || []);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!userId) return;
      try {
        const res = await apiJson<{ items: Array<{ id: string; title: string }> }>(`/api/initiatives/my?userId=${encodeURIComponent(userId)}`);
        setMyInits(res?.items || []);
      } catch {}
    })();
  }, [userId]);

  async function start() {
    if (!userId) { alert('로그인이 필요합니다.'); return; }
    if (!tplId) { alert('템플릿을 선택하세요.'); return; }
    if (!startTitle.trim()) { alert('세부 제목을 입력하세요.'); return; }
    const finalTitle = selected ? `${selected.title} - ${startTitle}` : startTitle;
    const taskAssignees = Object.entries(assignees)
      .filter(([_, v]) => !!v)
      .map(([k, v]) => ({ taskTemplateId: k, assigneeId: v }));
    const taskPlans = Object.entries(plans)
      .map(([k, v]) => ({
        taskTemplateId: k,
        plannedStartAt: v.plannedStartAt || undefined,
        plannedEndAt: v.plannedEndAt || undefined,
        deadlineAt: v.deadlineAt || undefined,
      }))
      .filter((x) => x.plannedStartAt || x.plannedEndAt || x.deadlineAt);
    const body = {
      templateId: tplId,
      title: finalTitle,
      startedById: userId,
      itemCode: itemCode || undefined,
      moldCode: moldCode || undefined,
      carModelCode: carModelCode || undefined,
      taskAssignees,
      taskPlans,
      initiativeId: initiativeId || undefined,
    };
    const inst = await apiJson<any>(`/api/processes`, { method: 'POST', body: JSON.stringify(body) });
    if (inst?.id) nav(`/process/instances/${inst.id}`);
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2>새 프로세스 시작</h2>
      {loading && <div>불러오는 중...</div>}
      <div className="resp-2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 380px) minmax(0, 1fr)', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <label>템플릿 선택</label>
          <select value={tplId} onChange={(e) => setTplId(e.target.value)}>
            <option value="">선택</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          {!templates.length && !loading && <div style={{ fontSize: 12, color: '#9ca3af' }}>사용 가능한 템플릿이 없습니다.</div>}
        </div>
        <div>
          {selected ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{selected.title}</div>
                {!!selected.description && <div style={{ fontSize: 12, color: '#6b7280' }}>{selected.description}</div>}
              </div>
              <div className="resp-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <label>
                  세부 제목
                  <input value={startTitle} onChange={(e) => setStartTitle(e.target.value)} placeholder="예: 2025-01-10 M123 2라인 이관" />
                </label>
                <label>
                  품번(Item Code)
                  <select value={itemCode} onChange={(e) => setItemCode(e.target.value)}>
                    <option value="">직접 입력</option>
                    {itemsMaster.map(it => (
                      <option key={it.code} value={it.code}>{it.code} · {it.name}</option>
                    ))}
                  </select>
                  {!itemCode && (
                    <input value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="예: ITEM-001" />
                  )}
                </label>
              </div>
              <div className="resp-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <label>
                  금형 번호(Mold)
                  <select value={moldCode} onChange={(e) => setMoldCode(e.target.value)}>
                    <option value="">직접 입력</option>
                    {moldsMaster.map(m => (
                      <option key={m.code} value={m.code}>{m.code} · {m.name}</option>
                    ))}
                  </select>
                  {!moldCode && (
                    <input value={moldCode} onChange={(e) => setMoldCode(e.target.value)} placeholder="예: M123" />
                  )}
                </label>
                <label>
                  차종(Car Model)
                  <select value={carModelCode} onChange={(e) => setCarModelCode(e.target.value)}>
                    <option value="">직접 입력</option>
                    {carModelsMaster.map(c => (
                      <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
                    ))}
                  </select>
                  {!carModelCode && (
                    <input value={carModelCode} onChange={(e) => setCarModelCode(e.target.value)} placeholder="예: SONATA" />
                  )}
                </label>
              </div>
              <div className="resp-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <label>
                  연결할 과제(Initiative)
                  <select value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)}>
                    <option value="">직접 입력</option>
                    {myInits.map(it => (
                      <option key={it.id} value={it.id}>{it.title}</option>
                    ))}
                  </select>
                  {!initiativeId && (
                    <input value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)} placeholder="Initiative ID 직접 입력" />
                  )}
                </label>
              </div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>과제 미리보기</div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {(selected.tasks || []).map((t, idx) => (
                    <div key={t.id || idx} style={{ border: '1px solid #eef2f7', borderRadius: 6, padding: 8 }}>
                      <div style={{ fontWeight: 600 }}>{t.name}{t.stageLabel ? ` · ${t.stageLabel}` : ''}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{t.taskType}</div>
                      {(t.assigneeHint || t.description) && (
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>담당자 힌트: {t.assigneeHint || t.description}</div>
                      )}
                      <div style={{ marginTop: 6 }}>
                        <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>담당자</label>
                        <select
                          value={(t.id && assignees[String(t.id)]) || ''}
                          onChange={(e) => t.id && setAssignees((prev) => ({ ...prev, [String(t.id)]: e.target.value }))}
                        >
                          <option value="">선택 안 함</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>{u.name}{u.orgName ? ` · ${u.orgName}` : ''}</option>
                          ))}
                        </select>
                      </div>
                      <div className="resp-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 8 }}>
                        <label>
                          <span style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>예정 시작</span>
                          <input type="datetime-local"
                            value={(t.id && plans[String(t.id)]?.plannedStartAt) || ''}
                            onChange={(e) => t.id && setPlans((prev) => ({ ...prev, [String(t.id)]: { ...prev[String(t.id)], plannedStartAt: e.target.value } }))}
                          />
                        </label>
                        <label>
                          <span style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>예정 종료</span>
                          <input type="datetime-local"
                            value={(t.id && plans[String(t.id)]?.plannedEndAt) || ''}
                            onChange={(e) => t.id && setPlans((prev) => ({ ...prev, [String(t.id)]: { ...prev[String(t.id)], plannedEndAt: e.target.value } }))}
                          />
                        </label>
                        <label>
                          <span style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>마감일</span>
                          <input type="datetime-local"
                            value={(t.id && plans[String(t.id)]?.deadlineAt) || ''}
                            onChange={(e) => t.id && setPlans((prev) => ({ ...prev, [String(t.id)]: { ...prev[String(t.id)], deadlineAt: e.target.value } }))}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                  {!selected.tasks?.length && <div style={{ fontSize: 12, color: '#9ca3af' }}>과제가 없습니다.</div>}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" onClick={start}>시작</button>
              </div>
            </div>
          ) : (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>왼쪽에서 템플릿을 선택하면 세부 정보를 입력할 수 있습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}
