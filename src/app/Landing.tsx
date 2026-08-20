import { useEffect, useRef, useState } from 'react';
import { PARAMS } from '../shared/constants';
import type { ProjectSummary } from '../store/db';
import { dropProject, listProjects, restoreProject } from '../store/persist';
import { useProject } from '../store/useProject';

/** First screen: drag in images or paste text, everything stays local. */
export function Landing(): JSX.Element {
  const addFiles = useProject((s) => s.addFiles);
  const addText = useProject((s) => s.addText);
  const errors = useProject((s) => s.errors);
  const [over, setOver] = useState(false);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<ProjectSummary[]>([]);
  const [demo, setDemo] = useState<{ done: number; total: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const loadDemo = async () => {
    setDemo({ done: 0, total: 1 });
    try {
      // The painter is only needed for the demo, so keep it out of the first paint.
      const { buildDemoFiles } = await import('../demo/sample');
      const files = await buildDemoFiles((done, total) => setDemo({ done, total }));
      setDemo(null);
      await addFiles(files);
    } finally {
      setDemo(null);
    }
  };

  useEffect(() => {
    void listProjects().then(setSaved);
  }, []);

  return (
    <div className="landing">
      <div
        className={over ? 'drop over' : 'drop'}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const files = [...event.dataTransfer.files];
          if (files.length) void addFiles(files);
        }}
      >
        <img className="mark" src={`${import.meta.env.BASE_URL}brand/mark.png`} alt="" />
        <h1>一键成册</h1>
        <span className="latin">autobook</span>
        <p>
          拖入 20–200 张图片（可混入 .txt / .md 文字），本地分析后自动排版，导出可印刷 PDF。
          <br />
          文件不会离开你的设备。
        </p>
        <div className="actions">
          <button className="primary" onClick={() => input.current?.click()}>
            选择图片
          </button>
          <button disabled={demo !== null} onClick={() => void loadDemo()}>
            {demo ? `生成示例照片 ${demo.done}/${demo.total}` : '试试示例相册'}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/*,.txt,.md,.markdown"
            style={{ display: 'none' }}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = '';
              if (files.length) void addFiles(files);
            }}
          />
        </div>
        <div style={{ marginTop: 18, textAlign: 'left' }}>
          <label>
            也可以直接粘贴一段文字<em>text</em>
          </label>
          <textarea
            rows={3}
            value={text}
            placeholder="例如：2024 年夏天，海边的第一场雨。"
            onChange={(event) => setText(event.target.value)}
          />
          <div className="actions" style={{ marginTop: 8, justifyContent: 'flex-start' }}>
            <button
              disabled={!text.trim()}
              onClick={() => {
                void addText(text);
                setText('');
              }}
            >
              加入文字
            </button>
            <span className="hint">单次最多 {PARAMS.hardMaxAssets} 个素材</span>
          </div>
        </div>
        {errors.length > 0 && (
          <div style={{ marginTop: 14, textAlign: 'left' }}>
            {errors.slice(0, 5).map((error, i) => (
              <div className="issue" key={i}>
                {error.fileName ? `${error.fileName}：` : ''}
                {error.reason}
              </div>
            ))}
          </div>
        )}
        {saved.length > 0 && (
          <div style={{ marginTop: 18, textAlign: 'left' }}>
            <label>
              继续上次的相册<em>recent</em>
            </label>
            {saved.slice(0, 4).map((project) => (
              <div className="row" key={project.id}>
                <button
                  onClick={() => {
                    void restoreProject(project.id);
                  }}
                >
                  {project.name}
                </button>
                <span className="hint">
                  {project.assetCount} 个素材 · {project.pageCount} 页
                </span>
                <span className="spacer" />
                <button
                  onClick={() => {
                    void dropProject(project.id).then(() => {
                      setSaved((list) => list.filter((item) => item.id !== project.id));
                    });
                  }}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
