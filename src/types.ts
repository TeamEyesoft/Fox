export interface NpmVersionManifest {
  name: string;
  version: string;
  _id?: string;
  description?: string;
  unity?: string;
  unityRelease?: string;
  dependencies?: Record<string, string>;
  dist: {
    tarball: string;
    shasum?: string;
    integrity?: string;
  };
  // Allow extra package.json fields (displayName, keywords, author, license…)
  // so Unity Package Manager receives the same metadata it expects.
  [key: string]: unknown;
}

export interface NpmPackument {
  name: string;
  displayName?: string;
  description?: string;
  "dist-tags": { latest?: string; [tag: string]: string | undefined };
  versions: Record<string, NpmVersionManifest>;
  time?: Record<string, string>;
  _fox?: { projectUrl?: string; unreleased?: boolean };
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
