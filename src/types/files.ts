export type Workspace = "personal" | "shared";

export type FileItem = {
  id: string;
  owner_id: string;
  title: string;
  kind: "image" | "file";
  workspace: Workspace;
  size_bytes: number;
  mime_type: string | null;
  created_at: string;
};

export type StartUploadResponse =
  | { mode: "single"; key: string; contentType: string; url: string }
  | {
      mode: "multipart";
      key: string;
      contentType: string;
      uploadId: string;
      partSize: number;
      partCount: number;
    };

export type ApiErrorBody = { error: { code: string; message: string } };
