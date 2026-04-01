export interface NpmVersionManifest {
  name: string;
  version: string;
  description?: string;
  unity?: string;
  unityRelease?: string;
  dependencies?: Record<string, string>;
  dist: {
    tarball: string;
    shasum?: string;
    integrity?: string;
  };
}

export interface NpmPackument {
  name: string;
  description?: string;
  "dist-tags": { latest: string; [tag: string]: string };
  versions: Record<string, NpmVersionManifest>;
  time?: Record<string, string>;
}

export interface GitLabProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  description: string | null;
  default_branch: string;
}

export interface GitLabReleaseLink {
  id: number;
  name: string;
  url: string;
  link_type: string;
}

export interface GitLabRelease {
  tag_name: string;
  name: string;
  description: string;
  created_at: string;
  released_at: string;
  assets: {
    links: GitLabReleaseLink[];
    sources: Array<{ format: string; url: string }>;
  };
}
