import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Layers, PackageOpen, ShieldCheck } from 'lucide-react';
import { EXPORT_FORMATS, exportName, formatBytes, scaledSize, type ExportFormat } from '../lib/files.mjs';
import { canvas, supportsAvif, toBlob } from '../imaging';
import { saveBlob } from '../platform';
import { Modal, Segmented, Slider } from '../ui';
import { drawGeometry, type Doc } from './document';
import { outputSize } from '../lib/geometry.mjs';

async function render(doc: Doc, image: HTMLCanvasElement, format: (typeof EXPORT_FORMATS)[number], percent: number, quality: number) {
  const out = outputSize(doc.geometry, doc.width, doc.height);
  const size = scaledSize(out.width, out.height, percent);
  const target = canvas(size.width, size.height);
  const context = target.getContext('2d')!;
  if (!format.alpha) { context.fillStyle = '#ffffff'; context.fillRect(0, 0, size.width, size.height); }
  context.imageSmoothingQuality = 'high';
  drawGeometry(context, image, doc, 0, 0, size.width / out.width, 'output');
  const blob = await toBlob(target, format.mime, format.lossy ? quality / 100 : undefined);
  target.width = target.height = 0;
  if (blob.type !== format.mime) throw new Error(`このブラウザは${format.label}の書き出しに対応していません。`);
  return blob;
}

export function ExportSheet({ doc, image, name, onClose, onToast, onProject }: { doc: Doc; image: HTMLCanvasElement; name: string; onClose: () => void; onToast: (message: string) => void; onProject?: (kind: 'psd' | 'imagee') => Promise<void> }) {
  const [packing, setPacking] = useState<'psd' | 'imagee' | null>(null);
  const pack = async (kind: 'psd' | 'imagee') => { setPacking(kind); try { await onProject?.(kind); } finally { setPacking(null); } };
  const [formatId, setFormatId] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(88);
  const [percent, setPercent] = useState(100);
  const [avif, setAvif] = useState(false);
  const [estimate, setEstimate] = useState<{ size: number } | { error: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const format = EXPORT_FORMATS.find(item => item.id === formatId)!;
  const out = outputSize(doc.geometry, doc.width, doc.height);
  const size = scaledSize(out.width, out.height, percent);
  const job = useRef(0);
  useEffect(() => { void supportsAvif().then(setAvif); }, []);
  const formats = useMemo(() => EXPORT_FORMATS.filter(item => item.id !== 'avif' || avif), [avif]);

  // Encode in the background so the size shown is the real file size, not a guess.
  useEffect(() => {
    const id = ++job.current;
    setEstimate(null);
    const timer = setTimeout(() => {
      render(doc, image, format, percent, quality).then(blob => id === job.current && setEstimate({ size: blob.size }), (e: Error) => id === job.current && setEstimate({ error: e.message }));
    }, 250);
    return () => clearTimeout(timer);
  }, [doc, image, format, percent, quality]);

  const save = async () => {
    setSaving(true);
    try {
      const blob = await render(doc, image, format, percent, quality);
      const saved = await saveBlob(blob, exportName(name, format.extension), format.extension, format.label);
      if (saved) { onToast(`「${saved}」を書き出しました。`); onClose(); }
    } catch (e) { onToast((e as Error).message || '書き出しに失敗しました。'); }
    finally { setSaving(false); }
  };

  return <Modal title="書き出し" onClose={onClose}>
    <div className="export">
      <div className="setting-row"><span>形式</span><Segmented label="形式" value={formatId} onChange={setFormatId} options={formats.map(item => ({ value: item.id, label: item.label }))}/></div>
      {format.lossy && <Slider label="画質" value={quality} min={1} max={100} unit="%" onChange={setQuality}/>}
      <Slider label="サイズ" value={percent} min={1} max={400} unit="%" onChange={setPercent}/>
      <div className="export-summary">
        <div><span>出力サイズ</span><b className="num">{size.width} × {size.height} px</b></div>
        <div><span>ファイルサイズ</span><b className="num">{estimate === null ? '計算中…' : 'error' in estimate ? '—' : formatBytes(estimate.size)}</b></div>
      </div>
      {estimate && 'error' in estimate && <p className="notice">{estimate.error}</p>}
      {!format.alpha && <p className="setting-note">JPEG は透明部分を白で塗りつぶします。</p>}
      <p className="setting-note with-icon"><ShieldCheck size={15} aria-hidden="true"/>位置情報などのメタデータは書き出した画像に含まれません。</p>
      {onProject && <div className="export-projects">
        <div><strong>レイヤーを残して保存</strong><span>PSD はテキスト・図形を画像として保存します。.imagee はすべてを編集できる状態で保存します。</span></div>
        <div className="export-project-buttons">
          <button type="button" className="btn" disabled={!!packing} onClick={() => void pack('psd')}><Layers size={15} aria-hidden="true"/>{packing === 'psd' ? '保存中…' : 'PSD'}</button>
          <button type="button" className="btn" disabled={!!packing} onClick={() => void pack('imagee')}><PackageOpen size={15} aria-hidden="true"/>{packing === 'imagee' ? '保存中…' : '.imagee'}</button>
        </div>
      </div>}
    </div>
    <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>キャンセル</button><button type="button" className="btn primary" disabled={saving || (estimate !== null && 'error' in estimate)} onClick={() => void save()}><Download size={16} aria-hidden="true"/>{saving ? '書き出し中…' : '書き出す'}</button></div>
  </Modal>;
}
