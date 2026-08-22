import exifr from 'exifr';

export interface ExifResult {
  takenAt?: number;
  takenAtSource: 'exif' | 'fileModified' | 'none';
  orientation?: number;
}

/**
 * Reads only the fields the layout engine needs. GPS is never requested,
 * so location data cannot leak into the project or the PDF (spec 19.2).
 */
export async function readExif(file: File | Blob): Promise<ExifResult> {
  const fallbackDate = file instanceof File && file.lastModified ? file.lastModified : undefined;
  try {
    const parsed = (await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: false,
      ifd1: false,
      iptc: false,
      xmp: false,
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'Orientation'],
    })) as Record<string, unknown> | undefined;

    const raw = parsed?.DateTimeOriginal ?? parsed?.CreateDate ?? parsed?.ModifyDate;
    const date = raw instanceof Date ? raw : typeof raw === 'string' ? new Date(raw) : undefined;
    const orientationRaw = parsed?.Orientation;
    const orientation = typeof orientationRaw === 'number' ? orientationRaw : undefined;

    if (date && !Number.isNaN(date.getTime())) {
      return { takenAt: date.getTime(), takenAtSource: 'exif', orientation };
    }
    if (fallbackDate) return { takenAt: fallbackDate, takenAtSource: 'fileModified', orientation };
    return { takenAtSource: 'none', orientation };
  } catch {
    if (fallbackDate) return { takenAt: fallbackDate, takenAtSource: 'fileModified' };
    return { takenAtSource: 'none' };
  }
}
