import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const API_URL = 'https://mdd8us3zk7.execute-api.eu-west-1.amazonaws.com/prod';

export interface UploadRequest {
  fileName: string;
  fileContent: string;
  uploadedBy: string;
  contentType?: string;
  expirationSeconds?: number;
}

export interface UploadResponse {
  fileId: string;
  s3Path: string;
  url: string;
  urlExpiration: string;
}

export interface FileItem {
  fileId: string;
  fileName: string;
  uploadedBy: string;
  uploadedDate: string;
  s3Path: string;
  url: string;
  urlExpiration: string;
  urlExpirationEpoch: number;
}

export interface FileListResponse {
  items: FileItem[];
}

@Injectable({
  providedIn: 'root'
})
export class FileUploadService {
  private readonly http = inject(HttpClient);

  uploadFile(file: File, uploadedBy: string): Observable<UploadResponse> {
    return new Observable<UploadResponse>((observer) => {
      const reader = new FileReader();

      reader.onload = () => {
        const base64Content = reader.result as string;
        // Remove the data URL prefix (e.g., "data:image/png;base64,")
        const base64Data = base64Content.split(',')[1];

        const uploadRequest: UploadRequest = {
          fileName: file.name,
          fileContent: base64Data,
          uploadedBy: uploadedBy,
          contentType: file.type || 'application/octet-stream',
          expirationSeconds: 3600
        };

        this.http.post<UploadResponse>(`${API_URL}/upload`, uploadRequest)
          .subscribe({
            next: (response) => observer.next(response),
            error: (error) => observer.error(error),
            complete: () => observer.complete()
          });
      };

      reader.onerror = () => {
        observer.error(new Error('Failed to read file'));
      };

      reader.readAsDataURL(file);
    });
  }

  getFiles(uploadedBy: string): Observable<FileListResponse> {
    return this.http.get<FileListResponse>(`${API_URL}/upload`, {
      params: { uploadedBy }
    });
  }
}
