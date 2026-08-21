import * as FileSystem from 'expo-file-system/legacy';
import { decode as atob } from 'base-64';

import { supabase } from './supabase';

const AVATAR_BUCKET = 'avatars';

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function contentTypeForUri(uri: string) {
  const lowerUri = uri.toLowerCase();

  if (lowerUri.endsWith('.png')) return 'image/png';
  if (lowerUri.endsWith('.webp')) return 'image/webp';
  if (lowerUri.endsWith('.heic')) return 'image/heic';
  if (lowerUri.endsWith('.heif')) return 'image/heif';

  return 'image/jpeg';
}

function extensionForContentType(contentType: string) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/heic') return 'heic';
  if (contentType === 'image/heif') return 'heif';

  return 'jpg';
}

export async function uploadProfileAvatar(userId: string, uri: string) {
  const contentType = contentTypeForUri(uri);
  const extension = extensionForContentType(contentType);
  const base64Image = await FileSystem.readAsStringAsync(uri, {
    encoding: 'base64',
  } as any);
  const imageBuffer = base64ToArrayBuffer(base64Image);
  const path = `${userId}/avatar.${extension}`;

  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, imageBuffer, {
      contentType,
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

/**
 * Group Whisper photos reuse the same public `avatars` bucket as profile
 * avatars, uploaded under the uploader's own folder -- the bucket's storage
 * policies only allow writing under `${auth.uid()}/...`, and since group
 * membership permissions are flat (any member can set the group photo),
 * this avoids needing a separate storage policy keyed on group membership.
 */
export async function uploadGroupAvatar(threadId: string, uploaderId: string, uri: string) {
  const contentType = contentTypeForUri(uri);
  const extension = extensionForContentType(contentType);
  const base64Image = await FileSystem.readAsStringAsync(uri, {
    encoding: 'base64',
  } as any);
  const imageBuffer = base64ToArrayBuffer(base64Image);
  const path = `${uploaderId}/group-${threadId}.${extension}`;

  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, imageBuffer, {
      contentType,
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
