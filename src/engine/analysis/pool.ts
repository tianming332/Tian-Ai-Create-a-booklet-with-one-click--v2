import { imageWorkerConcurrency } from '../../shared/constants';
import type { VisualFeatures } from '../../shared/types';
import { analyzeImageBlob } from './image';
import type { AnalyzeResponse } from './analyze.worker';

export interface AnalyzeJob {
  id: string;
  blob: Blob;
}

export interface AnalyzeOutcome {
  id: string;
  visual?: VisualFeatures;
  thumb?: Blob;
  warnings: string[];
  error?: string;
}

function workerSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

/**
 * Bounded-concurrency image analysis pool.
 * Falls back to sliced main-thread work when Workers/OffscreenCanvas are absent,
 * so old browsers stay usable (spec 17.3).
 */
export class AnalyzerPool {
  private workers: Worker[] = [];
  private readonly concurrency: number;

  constructor(concurrency = imageWorkerConcurrency()) {
    this.concurrency = concurrency;
  }

  async run(jobs: AnalyzeJob[], onProgress?: (done: number, total: number) => void): Promise<AnalyzeOutcome[]> {
    const total = jobs.length;
    const results = new Array<AnalyzeOutcome>(total);
    let cursor = 0;
    let done = 0;
    const useWorkers = workerSupported();

    const runOne = async (index: number, worker?: Worker): Promise<void> => {
      const job = jobs[index];
      try {
        if (worker) {
          results[index] = await this.viaWorker(worker, job);
        } else {
          const r = await analyzeImageBlob(job.blob);
          results[index] = { id: job.id, visual: r.visual, thumb: r.thumb, warnings: r.warnings };
        }
      } catch (error) {
        results[index] = {
          id: job.id,
          warnings: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
      done += 1;
      onProgress?.(done, total);
    };

    const lanes = Array.from({ length: Math.min(this.concurrency, Math.max(1, total)) }, async () => {
      const worker = useWorkers ? this.spawn() : undefined;
      while (cursor < total) {
        const index = cursor;
        cursor += 1;
        await runOne(index, worker);
        // Yield so the UI thread can paint between items in fallback mode.
        if (!worker) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    await Promise.all(lanes);
    this.dispose();
    return results;
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('./analyze.worker.ts', import.meta.url), { type: 'module' });
    this.workers.push(worker);
    return worker;
  }

  private viaWorker(worker: Worker, job: AnalyzeJob): Promise<AnalyzeOutcome> {
    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<AnalyzeResponse>) => {
        if (event.data.id !== job.id) return;
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        if (event.data.ok) {
          resolve({ id: job.id, visual: event.data.visual, thumb: event.data.thumb, warnings: event.data.warnings });
        } else {
          resolve({ id: job.id, warnings: [], error: event.data.error });
        }
      };
      const onError = (event: ErrorEvent) => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        reject(new Error(event.message));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ id: job.id, blob: job.blob });
    });
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
  }
}
