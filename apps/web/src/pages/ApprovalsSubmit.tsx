import { useEffect, useRef, useState } from 'react';
import { apiJson } from '../lib/api';
import { UserPicker, type PickedUser } from '../components/UserPicker';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { uploadFile } from '../lib/upload';
import '../styles/editor.css';
import { BpmnMiniView } from '../components/BpmnMiniView';
import { toSafeHtml } from '../lib/richText';

export function ApprovalsSubmit() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const processInstanceId = params?.get('processInstanceId') || '';
  const taskInstanceId = params?.get('taskInstanceId') || '';
  const [steps, setSteps] = useState<Array<{ id: string; name: string }>>([]);
  const [procTasks, setProcTasks] = useState<any[]>([]);
  const [selectedTask, setSelectedTask] = useState<{ instanceId: string; taskId: string } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [dueAt, setDueAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState('');
  const [teamName, setTeamName] = useState<string>(() => (typeof localStorage !== 'undefined' ? (localStorage.getItem('teamName') || '') : ''));
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [attachments, setAttachments] = useState<Array<{ url: string; name?: string; filename?: string }>>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const editorEl = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<Quill | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const [attachOneDriveOk, setAttachOneDriveOk] = useState<boolean>(false);
  const [processDetailPopup, setProcessDetailPopup] = useState<any>(null);
  const [processDetailLoading, setProcessDetailLoading] = useState(false);

  const requestedById = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';

  useEffect(() => {
    if (!editorEl.current) return;
    if (quillRef.current) return;
    const toolbar = [
      [{ header: [1, 2, 3, false] }],
      [{ font: [] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link', 'image'],
      [{ color: [] }, { background: [] }],
      [{ align: [] }],
      ['clean'],
    ];
    const q = new Quill(editorEl.current, {
      theme: 'snow',
      modules: {
        toolbar: {
          container: toolbar,
          handlers: { image: onImageUpload },
        },
      },
      placeholder: '결재 내용을 입력하고, 이미지 버튼으로 그림을 업로드하세요.',
    } as any);
    q.on('text-change', () => setContentHtml(q.root.innerHTML));
    // robust paste/drop handlers to avoid navigation and large base64 embeds
    const onPaste = async (e: ClipboardEvent) => {
      try {
        const items = e.clipboardData?.items as DataTransferItemList | undefined;
        if (!items) return;
        const imgs = Array.from(items).filter((i: DataTransferItem) => i.type.startsWith('image/'));
        const html = e.clipboardData?.getData('text/html') || '';
        if (imgs.length) {
          e.preventDefault();
          e.stopPropagation();
          for (const it of imgs) {
            const f = it.getAsFile();
            if (!f) continue;
            const up = await uploadFile(f);
            const range = (q as any).getSelection?.(true);
            if (range) (q as any).insertEmbed(range.index, 'image', up.url, 'user');
            else (q as any).insertEmbed(0, 'image', up.url, 'user');
          }
          return;
        }
        if (html && (html.includes('src="data:') || html.includes("src='data:"))) {
          e.preventDefault();
          e.stopPropagation();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const imgsEl = Array.from(doc.images || []).filter((im) => im.src.startsWith('data:'));
          for (const im of imgsEl) {
            try {
              const res = await fetch(im.src);
              const blob = await res.blob();
              const f = new File([blob], 'pasted.' + (blob.type.includes('png') ? 'png' : 'jpg'), { type: blob.type });
              const up = await uploadFile(f);
              im.src = up.url;
            } catch {
              im.remove();
            }
          }
          const range = (q as any).getSelection?.(true);
          const sane = doc.body.innerHTML;
          if (range) (q as any).clipboard.dangerouslyPasteHTML(range.index, sane, 'user');
          else (q as any).clipboard.dangerouslyPasteHTML(0, sane, 'user');
          return;
        }
      } catch (err: any) {
        setError(err?.message || '이미지 업로드 실패');
      }
    };
    const onDrop = async (e: DragEvent) => {
      try {
        const files = e.dataTransfer?.files as FileList | undefined;
        if (!files || !files.length) return;
        const imgs = Array.from(files).filter((f: File) => f.type.startsWith('image/'));
        if (imgs.length) {
          e.preventDefault();
          e.stopPropagation();
          for (const f of imgs) {
            const up = await uploadFile(f);
            const range = (q as any).getSelection?.(true);
            if (range) (q as any).insertEmbed(range.index, 'image', up.url, 'user');
            else (q as any).insertEmbed(0, 'image', up.url, 'user');
          }
        }
      } catch (err: any) {
        setError(err?.message || '이미지 업로드 실패');
      }
    };
    const onDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    (q.root as HTMLElement)?.addEventListener('paste', onPaste as any);
    (q.root as HTMLElement)?.addEventListener('drop', onDrop as any);
    (q.root as HTMLElement)?.addEventListener('dragover', onDragOver as any);
    quillRef.current = q;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!requestedById) return;
        const items = await apiJson<any[]>(`/api/processes/inbox?assigneeId=${encodeURIComponent(requestedById)}&status=READY`);
        const list = (items || []).filter((t: any) => String(t.taskType).toUpperCase() === 'APPROVAL');
        setProcTasks(list);
        // If params were provided via URL, prefer that as selected
        if (processInstanceId && taskInstanceId) setSelectedTask({ instanceId: processInstanceId, taskId: taskInstanceId });
      } catch {}
    })();
  }, [requestedById]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiJson<{ items: any[] }>(`/api/orgs`);
        const options = (res.items || []).filter((u: any) => u.type === 'TEAM').map((u: any) => u.name).sort();
        setTeams(options);
        if (!teamName && options.length > 0) setTeamName(options[0]);
      } catch {}
    })();
  }, []);

  function addStep(u: PickedUser) {
    setSteps((prev) => [...prev, { id: u.id, name: u.name }]);
    setShowPicker(false);
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return next;
      const t = next[idx];
      next[idx] = next[j];
      next[j] = t;
      return next;
    });
  }

  function stripHtml(html: string) {
    const el = document.createElement('div');
    el.innerHTML = html || '';
    return (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
  }

  async function openProcessDetail() {
    const pid = selectedTask?.instanceId || processInstanceId;
    if (!pid) return;
    setProcessDetailLoading(true);
    try {
      const d = await apiJson<any>(`/api/processes/${encodeURIComponent(pid)}`);
      setProcessDetailPopup(d);
    } catch {
      alert('프로세스 정보를 불러오지 못했습니다.');
    } finally {
      setProcessDetailLoading(false);
    }
  }

  async function onImageUpload() {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        try {
          const file = input.files?.[0];
          if (!file) return;
          const up = await uploadFile(file);
          const editor = quillRef.current as any;
          const range = editor?.getSelection?.(true);
          if (editor && range) {
            editor.insertEmbed(range.index, 'image', up.url, 'user');
            editor.setSelection(range.index + 1, 0, 'user');
          } else if (editor) {
            editor.insertEmbed(0, 'image', up.url, 'user');
          }
        } catch (e: any) {
          setError(e?.message || '이미지 업로드 실패');
        }
      };
      input.click();
    } catch (e: any) {
      setError(e?.message || '이미지 업로드 실패');
    }
  }

  async function addAttachmentFiles(list: FileList | null) {
    const files = Array.from(list || []);
    if (!files.length) return;
    try {
      for (const f of files) {
        // eslint-disable-next-line no-await-in-loop
        const up = await uploadFile(f);
        setAttachments((prev) => [...prev, { url: up.url, name: up.name || f.name, filename: up.filename || f.name }]);
      }
    } catch (e: any) {
      setError(e?.message || '첨부 파일 업로드 실패');
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (!requestedById) { setError('로그인이 필요합니다.'); return; }
    const missing: string[] = [];
    if (!teamName) missing.push('팀명');
    if (!title) missing.push('제목');
    if (!stripHtml(contentHtml)) missing.push('내용');
    if (steps.length === 0) missing.push('결재자');
    if (missing.length) { setError(`${missing.join(', ')} 입력이 필요합니다.`); return; }
    setLoading(true);
    setError(null);
    setOkMsg('');
    try {
      const res = await apiJson<{ id: string }>(
        '/api/worklogs/simple',
        {
          method: 'POST',
          body: JSON.stringify({
            userId: requestedById,
            teamName,
            taskName: title || 'Approval',
            title,
            content: stripHtml(contentHtml),
            contentHtml: contentHtml || undefined,
            attachments: { files: attachments },
          }),
        }
      );
      const body: any = { subjectType: 'Worklog', subjectId: res.id, requestedById };
      body.steps = steps.map((s) => ({ approverId: s.id }));
      if (dueAt) body.dueAt = new Date(dueAt).toISOString();
      const res2 = await apiJson<any>('/api/approvals', { method: 'POST', body: JSON.stringify(body) });
      // If invoked from a process task, complete it with approvalRequestId
      const linkage = selectedTask || (processInstanceId && taskInstanceId ? { instanceId: processInstanceId, taskId: taskInstanceId } : null);
      if (linkage && res2?.id) {
        try {
          await apiJson(`/api/processes/${encodeURIComponent(linkage.instanceId)}/tasks/${encodeURIComponent(linkage.taskId)}/complete`, {
            method: 'POST',
            body: JSON.stringify({ approvalRequestId: res2.id }),
          });
        } catch {}
      }
      setOkMsg(`요청 완료: ${res2?.id || ''}`);
      setSteps([]);
      setDueAt('');
      setTitle('');
      setContentHtml('');
      setAttachments([]);
      setSelectedTask(null);
    } catch (e: any) {
      setError(e?.message || '요청 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 640, margin: '24px auto' }}>
      {requestedById ? null : <div style={{ color: '#DC2626' }}>로그인이 필요합니다.</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {okMsg && <div style={{ color: '#0F3D73' }}>{okMsg}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        <h3>프로세스 결재 대상 (선택)</h3>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, display: 'grid', gap: 8 }}>
          {(procTasks || []).map((t: any) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <b>{t.instance?.title || '-'}</b>
                <span style={{ marginLeft: 8, color: '#64748b' }}>{t.stageLabel ? `· ${t.stageLabel}` : ''}</span>
                <div style={{ fontSize: 12, color: '#334155' }}>{t.name}</div>
              </div>
              <button type="button" style={ghostBtn} onClick={() => setSelectedTask({ instanceId: t.instance?.id, taskId: t.id })}>
                {selectedTask?.taskId === t.id ? '선택됨' : '선택'}
              </button>
            </div>
          ))}
          {!procTasks.length && <div style={{ fontSize: 12, color: '#9ca3af' }}>현재 결재 대상 프로세스 과제가 없습니다.</div>}
        </div>
        {(selectedTask || processInstanceId) && (
          <button type="button" style={{ ...ghostBtn, marginTop: 4, fontSize: 12 }} onClick={openProcessDetail} disabled={processDetailLoading}>
            {processDetailLoading ? '불러오는 중...' : '프로세스 상세 보기 (이전 업무일지 확인)'}
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <label>팀</label>
        <select value={teamName} onChange={(e) => setTeamName(e.target.value)} style={input}>
          {teams.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <label>제목</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
        <label>결재선</label>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            {steps.map((s, idx) => (
              <div key={`${s.id}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={chip}>{idx + 1}</span>
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={{ color: '#64748b' }}>({s.id})</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button type="button" style={ghostBtn} onClick={() => moveStep(idx, -1)}>▲</button>
                  <button type="button" style={ghostBtn} onClick={() => moveStep(idx, 1)}>▼</button>
                  <button type="button" style={ghostBtn} onClick={() => removeStep(idx)}>삭제</button>
                </span>
              </div>
            ))}
            <div>
              <button type="button" style={primaryBtn} onClick={() => setShowPicker(true)}>결재자 추가</button>
              {showPicker && (
                <div style={{ marginTop: 8 }}>
                  <UserPicker onSelect={addStep} onClose={() => setShowPicker(false)} />
                </div>
              )}
            </div>
          </div>
        </div>
        <label>기한(선택)</label>
        <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={input} />
        <label>내용</label>
        <div className="quill-box" style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 4, overflow: 'hidden' }}>
          <div ref={(r) => (editorEl.current = r)} style={{ minHeight: 240, width: '100%' }} />
        </div>
        <label>첨부 파일</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            ref={attachInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              addAttachmentFiles(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            style={ghostBtn}
            onClick={() => {
              if (!attachOneDriveOk) {
                const ok = window.confirm('원드라이브(회사)에서 받은 파일만 업로드하세요. 계속할까요?');
                if (!ok) return;
                setAttachOneDriveOk(true);
              }
              attachInputRef.current?.click();
            }}
          >파일 선택</button>
          <button
            type="button"
            style={ghostBtn}
            onClick={() => window.open('https://office.com/launch/onedrive', '_blank', 'noopener,noreferrer')}
          >OneDrive 열기</button>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#64748b' }}>
          <input type="checkbox" checked={attachOneDriveOk} onChange={(e) => setAttachOneDriveOk(e.target.checked)} />
          원드라이브 파일만 업로드합니다
        </label>
        <div style={{ fontSize: 12, color: '#64748b' }}>원드라이브 파일만 올려주세요. (브라우저 제한으로 원드라이브 폴더를 자동으로 열 수는 없습니다)</div>
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((f, i) => (
              <div key={`${f.url}-${i}`} className="attachment-item" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <a className="file-link" href={f.url} target="_blank" rel="noreferrer">{f.name || f.url}</a>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => removeAttachment(i)}>삭제</button>
              </div>
            ))}
          </div>
        )}
        <button onClick={submit} disabled={!requestedById || loading} style={primaryBtn}>
          {loading ? '요청중…' : '결재 요청'}
        </button>
      </div>

      {processDetailPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={() => setProcessDetailPopup(null)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 'min(900px, 95vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0 }}>프로세스 상세: {processDetailPopup.title}</h4>
              <button style={ghostBtn} onClick={() => setProcessDetailPopup(null)}>닫기</button>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
              상태: {processDetailPopup.status} · 시작: {processDetailPopup.startAt ? new Date(processDetailPopup.startAt).toLocaleDateString() : '-'}
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              {processDetailPopup.template?.description && (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>프로세스 설명</div>
                  <div style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: toSafeHtml(processDetailPopup.template.description) }} />
                </div>
              )}
              {processDetailPopup.template?.bpmnJson && (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 12px', background: '#f9fafb', fontWeight: 700, fontSize: 13, borderBottom: '1px solid #e5e7eb' }}>업무 흐름도</div>
                  <div style={{ padding: 12 }}><BpmnMiniView bpmn={processDetailPopup.template.bpmnJson} height={400} /></div>
                </div>
              )}
              {(processDetailPopup.template?.tasks || []).length > 0 && (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>노드별 설명</div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {(processDetailPopup.template?.tasks || []).map((tt: any) => (
                      <div key={tt.id} style={{ border: '1px solid #eef2f7', borderRadius: 6, padding: 10 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 600 }}>{tt.name || '-'}</span>
                          <span style={{ fontSize: 11, color: '#6b7280', background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>{tt.taskType}</span>
                        </div>
                        {tt.description ? (
                          <div style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: toSafeHtml(tt.description) }} />
                        ) : (
                          <div style={{ fontSize: 12, color: '#9ca3af' }}>설명 없음</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ padding: '6px 8px', background: '#f9fafb', fontWeight: 700, fontSize: 12 }}>과제 진행 현황</div>
                {(() => {
                  const d = processDetailPopup;
                  const tmplTasks = ((d.template?.tasks || []) as any[]).slice().sort((a: any, b: any) => (Number(a.orderHint || 0) - Number(b.orderHint || 0)));
                  if (!tmplTasks.length) return <div style={{ padding: 10, fontSize: 12, color: '#9ca3af' }}>템플릿 태스크가 없습니다.</div>;
                  const seqMap = new Map<string, number>();
                  tmplTasks.forEach((t: any, idx: number) => seqMap.set(String(t.id), idx + 1));
                  const group = new Map<string, any[]>();
                  for (const t of (d.tasks || [])) {
                    const arr = group.get(t.taskTemplateId) || [];
                    arr.push(t);
                    group.set(t.taskTemplateId, arr);
                  }
                  const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '-');
                  return (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: '0.5fr 1.6fr 1fr 3fr', padding: '6px 8px', fontWeight: 600, fontSize: 12, borderBottom: '1px solid #eef2f7' }}>
                        <div>#</div>
                        <div>단계/태스크</div>
                        <div>유형</div>
                        <div>담당 / 상태 / 업무일지</div>
                      </div>
                      {tmplTasks.map((tt: any) => {
                        const idx = seqMap.get(String(tt.id)) || 0;
                        const line = (group.get(tt.id) || []).slice().sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                        return (
                          <div key={tt.id} style={{ display: 'grid', gridTemplateColumns: '0.5fr 1.6fr 1fr 3fr', padding: '6px 8px', borderTop: '1px solid #eef2f7', fontSize: 12, alignItems: 'start' }}>
                            <div>{idx}</div>
                            <div style={{ display: 'grid', gap: 2 }}>
                              <div style={{ fontWeight: 600 }}>{tt.name || '-'}</div>
                              {tt.stageLabel ? <div style={{ color: '#6b7280' }}>{tt.stageLabel}</div> : null}
                            </div>
                            <div>
                              <span style={{ background: tt.taskType === 'WORKLOG' ? '#FEF9C3' : '#F1F5F9', color: '#334155', borderRadius: 999, padding: '0 6px' }}>{tt.taskType}</span>
                            </div>
                            <div style={{ display: 'grid', gap: 6 }}>
                              {line.length ? line.map((ins: any) => {
                                const st = ins.status;
                                const stBg = st === 'COMPLETED' ? '#DCFCE7' : st === 'IN_PROGRESS' ? '#DBEAFE' : '#F1F5F9';
                                const stFg = st === 'COMPLETED' ? '#166534' : st === 'IN_PROGRESS' ? '#1E3A8A' : '#334155';
                                return (
                                  <div key={ins.id} style={{ background: '#fafafa', borderRadius: 6, padding: 8 }}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                                      <span style={{ fontWeight: 600 }}>{ins.assignee?.name || '담당 미지정'}</span>
                                      <span style={{ color: '#6b7280', fontSize: 11 }}>계획: {fmtDate(ins.plannedStartAt)} ~ {fmtDate(ins.plannedEndAt)}</span>
                                      {ins.actualEndAt && <span style={{ color: '#059669', fontSize: 11 }}>완료: {fmtDate(ins.actualEndAt)}</span>}
                                      <span style={{ background: stBg, color: stFg, borderRadius: 999, padding: '0 6px', fontSize: 11 }}>{st}</span>
                                    </div>
                                    {(ins.worklogs || []).length > 0 && (
                                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #eef2f7' }}>
                                        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>업무일지 ({ins.worklogs.length}건)</div>
                                        <div style={{ display: 'grid', gap: 4 }}>
                                          {(ins.worklogs || []).map((wl: any) => (
                                            <div key={wl.id} style={{ fontSize: 12, padding: 6, background: '#fff', borderRadius: 4, border: '1px solid #e5e7eb' }}>
                                              <div style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
                                                <span style={{ color: '#6b7280' }}>{new Date(wl.createdAt).toLocaleString()}</span>
                                                <span style={{ fontWeight: 500 }}>{wl.createdBy?.name || '-'}</span>
                                              </div>
                                              <div style={{ color: '#475569' }} dangerouslySetInnerHTML={{ __html: toSafeHtml(wl.note || '(내용 없음)') }} />
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              }) : <span style={{ fontSize: 12, color: '#94a3b8' }}>담당 없음</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const input: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#0F3D73',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: '6px 10px',
  fontWeight: 600,
};

const chip: React.CSSProperties = {
  background: '#E6EEF7',
  color: '#0F3D73',
  border: '1px solid #0F3D73',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 12,
  fontWeight: 700,
};
