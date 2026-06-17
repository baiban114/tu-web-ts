import { isMockDataSource } from '@/dev/dataSource';

export interface FileUploadResult {
  id: string;
  url: string;
  contentType: string;
  sizeBytes: number;
}

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function buildUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE_URL}${path}`;
}

export async function uploadFile(file: File): Promise<FileUploadResult> {
  if (isMockDataSource()) {
    return {
      id: `mock-file-${Date.now()}`,
      url: URL.createObjectURL(file),
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    };
  }

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(buildUrl('/api/files'), {
    method: 'POST',
    body: formData,
  });

  let payload: ApiEnvelope<FileUploadResult> | null = null;
  try {
    payload = (await response.json()) as ApiEnvelope<FileUploadResult>;
  } catch {
    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }
  }

  if (!response.ok) {
    throw new Error(payload?.message || `Upload failed with status ${response.status}`);
  }

  if (!payload || payload.code !== 0) {
    throw new Error(payload?.message || 'Upload failed');
  }

  return payload.data;
}
