/**
 * 账号资料变更 hook：`PATCH /me` 与头像上传/删除。
 *
 * 账号状态只有一个来源（`state/accountSession.ts`）：变更成功后把服务端返回的
 * 最新账号与资料写回 store，顶栏、个人主页与设置页会立即同步，不需要各自刷新。
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { useAccountSessionStore } from '@/state/accountSession';
import { api } from './client';
import type { ProfileUpdateResult, UpdateMePayload } from './types';

function applyResult(result: ProfileUpdateResult): ProfileUpdateResult {
  useAccountSessionStore.getState().applyAccountUpdate(result.user, result.profile);
  return result;
}

export function useUpdateMe(): UseMutationResult<ProfileUpdateResult, Error, UpdateMePayload> {
  return useMutation({
    mutationFn: (payload: UpdateMePayload) => api.updateMe(payload),
    onSuccess: applyResult,
  });
}

export interface UploadAvatarVariables {
  file: Blob;
  fileName?: string;
}

export function useUploadAvatar(): UseMutationResult<
  ProfileUpdateResult,
  Error,
  UploadAvatarVariables
> {
  return useMutation({
    mutationFn: (input: UploadAvatarVariables) => api.uploadAvatar(input.file, input.fileName),
    onSuccess: applyResult,
  });
}

export function useDeleteAvatar(): UseMutationResult<ProfileUpdateResult, Error, void> {
  return useMutation({
    mutationFn: () => api.deleteAvatar(),
    onSuccess: applyResult,
  });
}
