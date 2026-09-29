export interface PhotoNameInfo {
  seq?: number;
  seqPrefix?: string;
  dev?: string;
  takenAt?: number;
  placeHint?: string;
  screenshot?: boolean;
}

const DEVICE_WORDS: Array<[RegExp, string]> = [
  [/iphone|ios/i, 'iphone'],
  [/pixel/i, 'pixel'],
  [/dji|mavic|air\s*2/i, 'dji'],
  [/wechat|微信|mmexport|wx_camera/i, 'wechat'],
  [/\bwa\b|whatsapp/i, 'whatsapp'],
  [/screenshot|屏幕快照|截屏|截图/i, 'screenshot'],
];

const SEQ_PATTERNS: Array<[RegExp, string]> = [
  [/\b(IMG)_(\d{3,6})\b/i, 'IMG'],
  [/\b(DSC)_?(\d{3,6})\b/i, 'DSC'],
  [/\b(P\d{3})_?(\d{3,5})\b/i, 'P'],
  [/\b(DJI)_(\d{3,6})\b/i, 'DJI'],
  [/\b(PXL)_(\d{8})/i, 'PXL'],
  [/(?:^|[_-])(\d{3,4})(?:\.[a-z0-9]+)?$/i, 'NUM'],
];

function parseNameDate(stem: string): number | undefined {
  const compact = stem.match(/(?:^|[^\d])((?:20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[_-]?([01]\d|2[0-3])([0-5]\d)([0-5]\d)?)?(?!\d)/);
  if (compact) {
    const [, y, m, d, hh = '12', mm = '00', ss = '00'] = compact;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }
  const dashed = stem.match(/(20\d{2})[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])/);
  if (dashed) {
    const date = new Date(Number(dashed[1]), Number(dashed[2]) - 1, Number(dashed[3]));
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }
  return undefined;
}

function placeHintFrom(stem: string): string | undefined {
  const cleaned = stem
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\b(IMG|DSC|DJI|PXL|Screenshot|屏幕快照|微信图片|MMExport)\b/gi, ' ')
    .replace(/20\d{6,14}/g, ' ')
    .replace(/[_-]*\d{2,6}[_-]*/g, ' ')
    .replace(/[_\-.]+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  if (!/[\u4e00-\u9fa5a-zA-Z]/.test(cleaned)) return undefined;
  if (/^(image|photo|img|pic|download|下载|图片)(\s+\d+)?$/i.test(cleaned)) return undefined;
  return cleaned.slice(0, 16);
}

/** Reads camera sequence, date, device and user words from a basename only. */
export function parsePhotoName(fileName: string | undefined): PhotoNameInfo {
  const base = String(fileName || '').split(/[/\\]/).pop() || '';
  const stem = base.replace(/\.[a-z0-9]+$/i, '');
  const info: PhotoNameInfo = {};
  const takenAt = parseNameDate(stem);
  if (takenAt) info.takenAt = takenAt;

  for (const [pattern, prefix] of SEQ_PATTERNS) {
    const match = base.match(pattern);
    if (!match) continue;
    const seq = Number(match[2] ?? match[1]);
    if (!Number.isFinite(seq)) continue;
    info.seq = seq;
    info.seqPrefix = prefix === 'NUM' ? 'NUM' : (match[1] || prefix).toUpperCase();
    break;
  }

  for (const [pattern, dev] of DEVICE_WORDS) {
    if (pattern.test(base)) {
      info.dev = dev;
      if (dev === 'screenshot') info.screenshot = true;
      break;
    }
  }
  if (/screenshot|屏幕快照|截屏/i.test(base)) info.screenshot = true;

  const hint = placeHintFrom(stem);
  if (hint) info.placeHint = hint;
  return info;
}
