/// <reference lib="webworker" />
import { analyzeImageBlob } from './image';

export interface AnalyzeRequest {
  id: string;
  blob: Blob;
}

export type AnalyzeResponse =
  | { id: string; ok: true; visual: import('../../shared/types').VisualFeatures; thumb: Blob; warnings: string[] }
  | { id: string; ok: false; error: string };

self.onmessage = async (event: MessageEvent<AnalyzeRequest>) => {
  const { id, blob } = event.data;
  try {
    const result = await analyzeImageBlob(blob);
    const response: AnalyzeResponse = {
      id,
      ok: true,
      visual: result.visual,
      thumb: result.thumb,
      warnings: result.warnings,
    };
    (self as unknown as Worker).postMessage(response);
  } catch (error) {
    const response: AnalyzeResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
