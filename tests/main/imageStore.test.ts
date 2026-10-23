import { describe, expect, it } from 'vitest'
import {
  ImageStoreError,
  STORED_SIZES,
  describeStoreError,
  imageExt,
  imageObjectKey,
  minioClientOptions
} from '../../src/main/imageStore'

describe('imageStore helpers (the MinIO client itself is verified live, not in unit tests)', () => {
  it('object keys follow shops/{shop}/listings/{listing}/{image}/{size}.{ext}', () => {
    expect(imageObjectKey(20987654, 1801234567, 6012345678, 'fullxfull', 'jpg')).toBe(
      'shops/20987654/listings/1801234567/6012345678/fullxfull.jpg'
    )
    expect(STORED_SIZES).toEqual(['fullxfull', '570xN'])
  })

  it('extension from the content-type, else the URL, else jpg', () => {
    expect(imageExt('image/png')).toBe('png')
    expect(imageExt('image/jpeg; charset=binary')).toBe('jpg')
    expect(imageExt(null, 'https://i.etsystatic.com/x/il_fullxfull.1_abcd.webp')).toBe('webp')
    expect(imageExt(null, 'https://i.etsystatic.com/x/il.JPEG?x=1')).toBe('jpg')
    expect(imageExt('application/octet-stream', 'https://x/y')).toBe('jpg')
    expect(imageExt(undefined, 'https://x/evil.exe')).toBe('jpg')
  })

  it('parses the endpoint for the minio client', () => {
    expect(minioClientOptions('http://127.0.0.1:9100')).toEqual({ endPoint: '127.0.0.1', port: 9100, useSSL: false })
    expect(minioClientOptions('https://s3.example.com')).toEqual({ endPoint: 's3.example.com', port: 443, useSSL: true })
    expect(minioClientOptions('http://[::1]:9100')).toEqual({ endPoint: '::1', port: 9100, useSSL: false })
  })

  it('describes client errors in Ukrainian', () => {
    expect(describeStoreError({ code: 'ECONNREFUSED' })).toMatch(/недоступний.*docker compose up -d/)
    expect(describeStoreError({ code: 'InvalidAccessKeyId' })).toMatch(/облікові дані/)
    expect(describeStoreError(new ImageStoreError('тайм-аут'))).toBe('тайм-аут')
    expect(describeStoreError(new Error('weird'))).toMatch(/Помилка MinIO: weird/)
  })
})
