import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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

export interface DeleteFileResponse {
  message: string;
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
          next: (response) => {
            // Create a hidden form to upload to S3 (avoids CORS preflight)
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = response.upload.url;
            form.enctype = 'multipart/form-data';
            form.style.display = 'none';

            // Add all the fields from the response
            Object.keys(response.upload.fields).forEach(key => {
              const input = document.createElement('input');
              input.type = 'hidden';
              input.name = key;
              input.value = response.upload.fields[key];
              form.appendChild(input);
            });

            // Add the file
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.name = 'file';
            fileInput.style.display = 'none';

            // Create a DataTransfer to set the file
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;
            form.appendChild(fileInput);

            // Create an iframe to submit the form without page reload
            const iframe = document.createElement('iframe');
            iframe.name = 'upload-iframe-' + Date.now();
            iframe.style.display = 'none';
            document.body.appendChild(iframe);

            form.target = iframe.name;
            document.body.appendChild(form);

            // Listen for iframe load (upload complete)
            iframe.onload = () => {
              // Clean up
              document.body.removeChild(form);
              document.body.removeChild(iframe);

              // Return the download URL info after successful upload
              observer.next({
                fileId: response.fileId,
                s3Path: response.s3Path,
                url: response.url,
                urlExpiration: response.urlExpiration
              });
              observer.complete();
            };

            // Submit the form
            form.submit();
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

  deleteFile(fileId: string, uploadedBy: string): Observable<DeleteFileResponse> {
    return this.http.delete<DeleteFileResponse>(`${API_URL}/upload`, {
      params: { fileId, uploadedBy }
    });
  }
}
