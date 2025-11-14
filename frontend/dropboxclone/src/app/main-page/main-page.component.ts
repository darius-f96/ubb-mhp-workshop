import { Component, inject, OnInit, signal } from '@angular/core';
import { OAuthService } from 'angular-oauth2-oidc';
import { CommonModule } from '@angular/common';
import { FileUploadService, FileItem } from '../service/file-upload.service';

@Component({
  selector: 'app-main-page',
  imports: [CommonModule],
  templateUrl: './main-page.component.html',
  styleUrl: './main-page.component.scss',
  standalone: true
})
export class MainPageComponent implements OnInit {
  private readonly oauthService = inject(OAuthService);
  private readonly uploadService = inject(FileUploadService);

  userName = signal<string>('');
  userEmail = signal<string>('');
  selectedFile = signal<File | null>(null);
  uploading = signal<boolean>(false);
  uploadError = signal<string | null>(null);
  uploadSuccess = signal<string | null>(null);
  files = signal<FileItem[]>([]);
  loadingFiles = signal<boolean>(false);
  filesError = signal<string | null>(null);
  deletingFiles = signal<Set<string>>(new Set());

  ngOnInit() {
    const claims = this.oauthService.getIdentityClaims() as any;
    if (claims) {
      // Try to get name from various possible claim fields
      const name = claims.name || claims.email || claims.preferred_username || 'User';
      const email = claims.email || claims.preferred_username || '';
      this.userName.set(name);
      this.userEmail.set(email);

      // Load user's files
      if (email) {
        this.loadFiles();
      }
    }
  }

  loadFiles() {
    const email = this.userEmail();
    if (!email) return;

    this.loadingFiles.set(true);
    this.filesError.set(null);

    this.uploadService.getFiles(email).subscribe({
      next: (response) => {
        this.files.set(response.items);
      },
      error: (error) => {
        console.error('Failed to load files:', error);
        this.filesError.set('Failed to load your files. Please try again.');
      },
      complete: () => {
        this.loadingFiles.set(false);
      }
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile.set(input.files[0]);
      this.uploadError.set(null);
      this.uploadSuccess.set(null);
      console.log('File selected:', this.selectedFile()?.name);
    }
  }

  uploadFile() {
    const file = this.selectedFile();
    const email = this.userEmail();

    if (!file) {
      this.uploadError.set('Please select a file first');
      return;
    }

    if (!email) {
      this.uploadError.set('User email not found');
      return;
    }

    this.uploading.set(true);
    this.uploadError.set(null);
    this.uploadSuccess.set(null);

    this.uploadService.uploadFile(file, email).subscribe({
      next: (response) => {
        console.log('Upload successful:', response);
        this.uploadSuccess.set(`File uploaded successfully! Download URL valid until ${new Date(response.urlExpiration).toLocaleString()}`);
        this.selectedFile.set(null);
        // Reset the file input
        const input = document.getElementById('fileInput') as HTMLInputElement;
        if (input) input.value = '';
        // Reload the file list
        this.loadFiles();
      },
      error: (error) => {
        console.error('Upload failed:', error);
        this.uploadError.set(error.error?.message || 'Failed to upload file. Please try again.');
      },
      complete: () => {
        this.uploading.set(false);
      }
    });
  }

  downloadFile(file: FileItem) {
    // Open the pre-signed URL in a new window/tab to download
    window.open(file.url, '_blank');
  }

  isUrlExpired(file: FileItem): boolean {
    return Date.now() / 1000 > file.urlExpirationEpoch;
  }

  refreshFileUrl(file: FileItem) {
    // Refresh the file list to get new pre-signed URLs
    this.loadFiles();
  }

  deleteFile(file: FileItem) {
    const email = this.userEmail();
    if (!email || this.isDeleting(file.fileId)) {
      return;
    }

    this.filesError.set(null);
    const updatedDeleting = new Set(this.deletingFiles());
    updatedDeleting.add(file.fileId);
    this.deletingFiles.set(updatedDeleting);

    const removeFromDeleting = () => {
      const current = new Set(this.deletingFiles());
      current.delete(file.fileId);
      this.deletingFiles.set(current);
    };

    this.uploadService.deleteFile(file.fileId, email).subscribe({
      next: () => {
        this.files.update(items => items.filter(item => item.fileId !== file.fileId));
      },
      error: (error) => {
        console.error('Failed to delete file:', error);
        this.filesError.set(error.error?.message || 'Failed to delete the file. Please try again.');
        removeFromDeleting();
      },
      complete: () => {
        removeFromDeleting();
      }
    });
  }

  isDeleting(fileId: string): boolean {
    return this.deletingFiles().has(fileId);
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString();
  }
}
