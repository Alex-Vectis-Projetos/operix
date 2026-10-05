import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { withPromiseTimeout } from "@/lib/asyncGuard";
import { apiRequest } from "@/lib/api";
import { uploadFile, deleteFiles, getFileUrl } from "@/lib/storage";

export function useUserAvatar() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!user?.id) throw new Error("Not authenticated");
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;

      await withPromiseTimeout<any>(
        uploadFile("avatars", path, file, file.type),
        10000,
        "avatar_upload",
      );
      const publicUrl = getFileUrl("avatars", path);
      await apiRequest("/account/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ avatar_url: publicUrl }),
        timeoutMs: 10000,
      });
      return publicUrl;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-profile"] });
      qc.invalidateQueries({ queryKey: ["all-profiles"] });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not authenticated");
      await apiRequest("/account/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ avatar_url: null }),
        timeoutMs: 10000,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-profile"] });
      qc.invalidateQueries({ queryKey: ["all-profiles"] });
    },
  });

  return { upload, remove };
}
