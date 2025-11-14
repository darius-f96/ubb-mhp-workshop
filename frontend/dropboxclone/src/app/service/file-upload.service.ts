import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';

const API_URL = 'https://mdd8us3zk7.execute-api.eu-west-1.amazonaws.com/prod';

export interface UploadRequest {
  fileName: string;
  fileContent?: string;  // Optional when using multipart
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

export interface MultipartUploadResponse {
  fileId: string;
  s3Path: string;
  upload: {
    url: string;
    fields: {
      [key: string]: string;
    };
    expiresIn: number;
  };
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
    // Check if file is larger than 9MB (use multipart upload)
    const nineMB = 9 * 1024 * 1024;
    if (file.size > nineMB) {
      return this.uploadFileMultipart(file, uploadedBy);
    }

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

  private uploadFileMultipart(file: File, uploadedBy: string): Observable<UploadResponse> {
    return new Observable<UploadResponse>((observer) => {
      const uploadRequest: UploadRequest = {
        fileName: file.name,
        uploadedBy: uploadedBy,
        contentType: file.type || 'application/octet-stream',
        expirationSeconds: 3600
      };

      // First, get the pre-signed POST URL from the backend
      this.http.post<MultipartUploadResponse>(`${API_URL}/upload?multipart=true`, uploadRequest)
        .subscribe({
          next: (response: MultipartUploadResponse) => {
            // Upload the file directly to S3 using the pre-signed POST
            const formData = new FormData();

            // Add all the fields from the response in the correct order
            Object.keys(response.upload.fields).forEach(key => {
              formData.append(key, response.upload.fields[key]);
            });

            // Add the file last
            formData.append('file', file);

            // Upload to S3
            this.http.post(response.upload.url, formData, {
              responseType: 'text',
              observe: 'response'
            }).subscribe({
              next: () => {
                // Return the download URL info after successful upload
                observer.next({
                  fileId: response.fileId,
                  s3Path: response.s3Path,
                  url: response.url,
                  urlExpiration: response.urlExpiration
                });
                observer.complete();
              },
              error: (error) => {
                // S3 might return 204 which some browsers treat as an error
                if (error.status === 204 || error.status === 0) {
                  observer.next({
                    fileId: response.fileId,
                    s3Path: response.s3Path,
                    url: response.url,
                    urlExpiration: response.urlExpiration
                  });
                  observer.complete();
                } else {
                  observer.error(error);
                }
              }
            });
          },
          error: (error) => observer.error(error)
        });
    });
  }

  getFiles(uploadedBy: string): Observable<FileListResponse> {
    return this.http.get<FileListResponse>(`${API_URL}/upload`, {
      params: { uploadedBy }
    });
  }
}
