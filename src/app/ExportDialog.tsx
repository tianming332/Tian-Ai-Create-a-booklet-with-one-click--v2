import { useMemo, useRef, useState } from 'react';
import { countIssues, preflight } from '../export/preflight';
import { fontsLoaded } from '../render/fonts';
import type { PreflightIssue } from '../shared/types';
import { useProject } from '../store/useProject';
import { buildSpreads, spreadIndexOfPage } from './hooks';

const MAX_LISTED = 40;

type ExportPhase = 'rendering' | 'saving';
type ExportQuality = 'fast' | 'standard' | 'print';

interface ReadyPdf {
  blob: Blob;
  fileName: string;
  fontFallback: boolean;
}

function safeFileName(name: string): string {
  const trimmed = name.trim().replace(/[\\/:*?"<>|]+/g, '_');
  return `${trimmed || 'autobook'}.pdf`;
}

/** Preflight report plus the PDF export run, with progress and cancellation. */
export function ExportDialog(props: { onClose: () => void }): JSX.Element {
  const store = useProject();
  const { pageSpec, grouping, assets, groups, pages, name } = store;
  const book = useMemo(
    () => ({ pageSpec, grouping, assets, groups, pages }),
    [pageSpec, grouping, assets, groups, pages],
  );
  const issues = useMemo(() => preflight({ book, fonts: fontsLoaded() }), [book]);
  const counts = countIssues(issues);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: pages.length });
  const [phase, setPhase] = useState<ExportPhase>('rendering');
  const [quality, setQuality] = useState<ExportQuality>('fast');
  const [ready, setReady] = useState<ReadyPdf | null>(null);
  const controller = useRef<AbortController | null>(null);

  const jumpTo = (issue: PreflightIssue) => {
    if (issue.pageIndex === undefined) return;
    const page = pages.find((p) => p.index === issue.pageIndex);
    if (!page) return;
    store.setStage('edit');
    store.showSpread(spreadIndexOfPage(buildSpreads(pages), page.id));
    store.select({ pageId: page.id, frameId: issue.frameId });
    props.onClose();
  };

  const run = async () => {
    const ctrl = new AbortController();
    controller.current = ctrl;
    setRunning(true);
    setProgress({ done: 0, total: pages.length });
    setPhase('rendering');
    setReady(null);
    try {
      // pdf-lib + fontkit are ~1 MB, so they load only when the user exports.
      const { exportPdf, downloadBlob } = await import('../export/pdf');
      const result = await exportPdf({
        book,
        fileName: safeFileName(name),
        quality,
        signal: ctrl.signal,
        onProgress: (done, total, nextPhase) => {
          setProgress({ done, total });
          setPhase(nextPhase);
        },
      });
      setReady(result);
      downloadBlob(result.blob, result.fileName);
      store.setToast(
        result.fontFallback
          ? 'PDF 已生成（如未下载，请点“再次下载”；中文字体使用了替代字体）'
          : 'PDF 已生成（如未自动下载，请点“再次下载”）',
      );
    } catch (error) {
      const err = error as Error;
      store.setToast(err.name === 'AbortError' ? '已取消导出' : `导出失败：${err.message}`);
    } finally {
      controller.current = null;
      setRunning(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-label="导出 PDF">
      <div className="card">
        <h3>
          <span>导出 PDF</span>
          <em>export</em>
          <button style={{ marginLeft: 'auto' }} onClick={props.onClose} disabled={running}>
            关闭
          </button>
        </h3>

        <p className="hint">
          {pages.length} 页 · {pageSpec.trimWidth}×{pageSpec.trimHeight}mm · 出血 {pageSpec.bleed}mm ·
          目标 {pageSpec.targetDpi} DPI · RGB
        </p>
        <p className="hint">
          检查结果：{counts.error} 个错误 · {counts.warning} 个警告 · {counts.info} 个提示
        </p>

        {!running && !ready ? (
          <div className="row" style={{ marginBottom: 12 }}>
            <label style={{ margin: 0 }}>导出质量</label>
            <select value={quality} onChange={(event) => setQuality(event.target.value as ExportQuality)}>
              <option value="fast">快速预览 · 160 DPI（推荐先测试）</option>
              <option value="standard">标准成册 · 240 DPI</option>
              <option value="print">印刷质量 · 300 DPI（最慢）</option>
            </select>
          </div>
        ) : null}

        <div className="issues">
          {issues.slice(0, MAX_LISTED).map((issue) => (
            <button
              key={issue.id}
              className={`issue ${issue.level}`}
              onClick={() => jumpTo(issue)}
              disabled={issue.pageIndex === undefined}
            >
              {issue.message}
            </button>
          ))}
          {issues.length > MAX_LISTED ? (
            <span className="hint">另有 {issues.length - MAX_LISTED} 条…</span>
          ) : null}
        </div>

        {running ? (
          <>
            <div className="bar">
              <i
                style={{
                  width: `${progress.total ? (progress.done / progress.total) * 100 : 5}%`,
                }}
              />
            </div>
            <div className="row">
              <span className="hint">
                {phase === 'saving'
                  ? '页面已完成，正在合成 PDF（大文件可能需要一些时间，请勿关闭页面）'
                  : `正在渲染 ${progress.done} / ${progress.total} 页`}
              </span>
              <span className="spacer" />
              <button onClick={() => controller.current?.abort()}>取消</button>
            </div>
          </>
        ) : ready ? (
          <div className="row">
            <span className="hint">PDF 已生成。浏览器若未自动下载，请点击右侧按钮。</span>
            <span className="spacer" />
            <button
              className="primary"
              onClick={() => {
                void import('../export/pdf').then(({ downloadBlob }) =>
                  downloadBlob(ready.blob, ready.fileName),
                );
              }}
            >
              再次下载 PDF
            </button>
          </div>
        ) : (
          <div className="row">
            <span className="hint">
              {counts.error ? '存在错误，仍可导出，但建议先修正。' : '可以导出。'}
            </span>
            <span className="spacer" />
            <button className="primary" onClick={() => void run()} disabled={!pages.length}>
              导出 PDF
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
