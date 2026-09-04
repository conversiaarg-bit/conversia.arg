import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { extname } from 'path';

export interface StoredFile {
  id: string;
  filename: string;
  url: string;
  type: 'image' | 'video';
  size: number;
  originalName: string;
  mimetype: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3: S3Client | null = null;
  private bucket = '';
  private s3BaseUrl = '';
  private useS3 = false;
  private uploadsDir = join(process.cwd(), 'uploads');

  // true si hay storage en la nube (S3/R2). Si es false, conviene guardar la media
  // como data URL (persiste en DB) en vez de disco efímero que se borra en cada deploy.
  get cloud(): boolean { return this.useS3; }

  onModuleInit() {
    const bucket = process.env.AWS_S3_BUCKET;
    const region = process.env.AWS_REGION ?? 'us-east-1';
    const accessKey = process.env.AWS_ACCESS_KEY_ID;
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
    const endpoint = process.env.AWS_ENDPOINT_URL; // for Cloudflare R2

    if (bucket && accessKey && secretKey) {
      this.bucket = bucket;
      this.useS3 = true;
      this.s3 = new S3Client({
        region,
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      });
      this.s3BaseUrl = endpoint
        ? `${endpoint}/${bucket}`
        : `https://${bucket}.s3.${region}.amazonaws.com`;
      this.logger.log(`☁️  StorageService: S3 mode (bucket=${bucket})`);
    } else {
      if (!existsSync(this.uploadsDir)) mkdirSync(this.uploadsDir, { recursive: true });
      this.logger.log('💾 StorageService: disk mode (set AWS_S3_BUCKET to enable S3)');
    }
  }

  async save(buffer: Buffer, originalName: string, mimetype: string): Promise<StoredFile> {
    const ext = extname(originalName).toLowerCase();
    const id = uuidv4();
    const filename = `${id}${ext}`;
    const type: 'image' | 'video' = mimetype.startsWith('video/') ? 'video' : 'image';

    if (this.useS3 && this.s3) {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: `uploads/${filename}`,
        Body: buffer,
        ContentType: mimetype,
        ACL: 'public-read' as any,
      }));
      return {
        id, filename,
        url: `${this.s3BaseUrl}/uploads/${filename}`,
        type, size: buffer.length, originalName, mimetype,
      };
    }

    // Disk fallback
    const filePath = join(this.uploadsDir, filename);
    writeFileSync(filePath, buffer);
    // La URL debe ser pública para que el navegador la cargue: si no hay BACKEND_URL,
    // en producción usamos el dominio del backend (localhost solo sirve en dev).
    const baseUrl = process.env.BACKEND_URL
      ?? (process.env.NODE_ENV === 'production'
        ? 'https://conversiaarg-production.up.railway.app'
        : `http://localhost:${process.env.PORT ?? 3000}`);
    return {
      id, filename,
      url: `${baseUrl}/uploads/${filename}`,
      type, size: buffer.length, originalName, mimetype,
    };
  }

  async delete(filename: string): Promise<void> {
    if (this.useS3 && this.s3) {
      await this.s3.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: `uploads/${filename}`,
      }));
      return;
    }
    const filePath = join(this.uploadsDir, filename);
    if (existsSync(filePath)) unlinkSync(filePath);
  }
}
