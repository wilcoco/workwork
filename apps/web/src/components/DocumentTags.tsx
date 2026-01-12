import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

interface MasterItem {
  code: string;
  name: string;
}

export interface DocumentTagsValue {
  itemCode?: string;
  moldCode?: string;
  carModelCode?: string;
  supplierCode?: string;
  equipmentCode?: string;
}

interface DocumentTagsProps {
  value: DocumentTagsValue;
  onChange: (value: DocumentTagsValue) => void;
  compact?: boolean;
}

export function DocumentTags({ value, onChange, compact }: DocumentTagsProps) {
  const [items, setItems] = useState<MasterItem[]>([]);
  const [molds, setMolds] = useState<MasterItem[]>([]);
  const [carModels, setCarModels] = useState<MasterItem[]>([]);
  const [suppliers, setSuppliers] = useState<MasterItem[]>([]);
  const [equipments, setEquipments] = useState<MasterItem[]>([]);
  const [manualItem, setManualItem] = useState(false);
  const [manualMold, setManualMold] = useState(false);
  const [manualCarModel, setManualCarModel] = useState(false);
  const [manualSupplier, setManualSupplier] = useState(false);
  const [manualEquipment, setManualEquipment] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [im, mm, cm, sm, em] = await Promise.all([
          apiJson<{ items: MasterItem[] }>(`/api/masters/items`),
          apiJson<{ items: MasterItem[] }>(`/api/masters/molds`),
          apiJson<{ items: MasterItem[] }>(`/api/masters/car-models`),
          apiJson<{ items: MasterItem[] }>(`/api/masters/suppliers`).catch(() => ({ items: [] })),
          apiJson<{ items: MasterItem[] }>(`/api/masters/equipments`).catch(() => ({ items: [] })),
        ]);
        setItems(im?.items || []);
        setMolds(mm?.items || []);
        setCarModels(cm?.items || []);
        setSuppliers(sm?.items || []);
        setEquipments(em?.items || []);
      } catch {}
    })();
  }, []);

  const inputStyle: React.CSSProperties = {
    border: '1px solid #CBD5E1',
    background: '#FFFFFF',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 13,
    outline: 'none',
    width: '100%',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 4,
    display: 'block',
  };

  const gridStyle: React.CSSProperties = compact
    ? { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }
    : { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 };

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: '#f8fafc' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8 }}>🏷️ 문서 태그 (선택)</div>
      <div style={gridStyle}>
        <div>
          <label style={labelStyle}>품번</label>
          {!manualItem ? (
            <div style={{ display: 'grid', gap: 4 }}>
              <select
                value={value.itemCode || ''}
                onChange={(e) => onChange({ ...value, itemCode: e.target.value || undefined })}
                style={inputStyle}
              >
                <option value="">선택</option>
                {items.map((it) => (
                  <option key={it.code} value={it.code}>{it.code} · {it.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => setManualItem(true)} style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>직접 입력</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              <input
                value={value.itemCode || ''}
                onChange={(e) => onChange({ ...value, itemCode: e.target.value || undefined })}
                placeholder="품번 입력"
                style={inputStyle}
              />
              <button type="button" onClick={() => setManualItem(false)} style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>목록에서 선택</button>
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle}>금형번호</label>
          {!manualMold ? (
            <div style={{ display: 'grid', gap: 4 }}>
              <select
                value={value.moldCode || ''}
                onChange={(e) => onChange({ ...value, moldCode: e.target.value || undefined })}
                style={inputStyle}
              >
                <option value="">선택</option>
                {molds.map((m) => (
                  <option key={m.code} value={m.code}>{m.code} · {m.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => setManualMold(true)} style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>직접 입력</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              <input
                value={value.moldCode || ''}
                onChange={(e) => onChange({ ...value, moldCode: e.target.value || undefined })}
                placeholder="금형번호 입력"
                style={inputStyle}
              />
              <button type="button" onClick={() => setManualMold(false)} style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>목록에서 선택</button>
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle}>차종</label>
          {!manualCarModel ? (
            <div style={{ display: 'grid', gap: 4 }}>
              <select
                value={value.carModelCode || ''}
                onChange={(e) => onChange({ ...value, carModelCode: e.target.value || undefined })}
                style={inputStyle}
              >
                <option value="">선택</option>
                {carModels.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => setManualCarModel(true)} style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>직접 입력</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              <input
                value={value.carModelCode || ''}
                onChange={(e) => onChange({ ...value, carModelCode: e.target.value || undefined })}
                placeholder="차종 입력"
                style={inputStyle}
              />
              <button type="button" onClick={() => setManualCarModel(false)} style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>목록에서 선택</button>
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle}>협력사</label>
          {!manualSupplier ? (
            <div style={{ display: 'grid', gap: 4 }}>
              <select
                value={value.supplierCode || ''}
                onChange={(e) => onChange({ ...value, supplierCode: e.target.value || undefined })}
                style={inputStyle}
              >
                <option value="">선택</option>
                {suppliers.map((s) => (
                  <option key={s.code} value={s.code}>{s.code} · {s.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => setManualSupplier(true)} style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>직접 입력</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              <input
                value={value.supplierCode || ''}
                onChange={(e) => onChange({ ...value, supplierCode: e.target.value || undefined })}
                placeholder="협력사 입력"
                style={inputStyle}
              />
              <button type="button" onClick={() => setManualSupplier(false)} style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>목록에서 선택</button>
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle}>설비</label>
          {!manualEquipment ? (
            <div style={{ display: 'grid', gap: 4 }}>
              <select
                value={value.equipmentCode || ''}
                onChange={(e) => onChange({ ...value, equipmentCode: e.target.value || undefined })}
                style={inputStyle}
              >
                <option value="">선택</option>
                {equipments.map((eq) => (
                  <option key={eq.code} value={eq.code}>{eq.code} · {eq.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => setManualEquipment(true)} style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>직접 입력</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              <input
                value={value.equipmentCode || ''}
                onChange={(e) => onChange({ ...value, equipmentCode: e.target.value || undefined })}
                placeholder="설비 입력"
                style={inputStyle}
              />
              <button type="button" onClick={() => setManualEquipment(false)} style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>목록에서 선택</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function DocumentTagsDisplay({ tags }: { tags?: DocumentTagsValue | null }) {
  if (!tags) return null;
  const parts: string[] = [];
  if (tags.itemCode) parts.push(`품번: ${tags.itemCode}`);
  if (tags.moldCode) parts.push(`금형: ${tags.moldCode}`);
  if (tags.carModelCode) parts.push(`차종: ${tags.carModelCode}`);
  if (tags.supplierCode) parts.push(`협력사: ${tags.supplierCode}`);
  if (tags.equipmentCode) parts.push(`설비: ${tags.equipmentCode}`);
  if (!parts.length) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
      {parts.map((p, i) => (
        <span key={i} style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: 4 }}>
          {p}
        </span>
      ))}
    </div>
  );
}
