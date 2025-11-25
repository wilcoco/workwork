/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  readonly VITE_COMPANY_NAME?: string;
  readonly VITE_GIT_TITLE?: string;
  readonly VITE_GIT_COMMIT?: string;
  readonly VITE_GIT_COMMIT_FULL?: string;
  readonly VITE_GIT_DATE?: string;
  readonly VITE_GIT_REPO?: string;
  readonly VITE_DEPLOY_TITLE?: string;
  readonly VITE_DEPLOY_DESC?: string;
  readonly VITE_DEPLOY_NOTE?: string;
  readonly VITE_SHOW_APPROVALS?: string;
  readonly VITE_SHOW_COOPS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
