export const contentTypes = ["image", "carousel", "reel", "other"] as const;

export type ContentType = (typeof contentTypes)[number];

export type LibraryPostMedia = {
  id: string;
  type: "image" | "video";
  url: string | null;
  sourcePath: string | null;
  thumbnailUrl: string | null;
  position: number;
};

export type LibraryPost = {
  id: string;
  externalId: string | null;
  postUrl: string;
  thumbnailUrl: string;
  mediaUrl: string | null;
  media: LibraryPostMedia[];
  authorUsername: string;
  caption: string;
  captionTranslation?: {text: string; sourceLanguages: string[]};
  tags: string[];
  savedAt: string | null;
  createdAt?: string | null;
  publishedAt: string | null;
  contentType: ContentType;
  mainTheme: string | null;
  likesCount: number | null;
  commentsCount: number | null;
  metadata: Record<string, unknown>;
  collections: string[];
  places?: LibraryPostPlace[];
};

export type LibraryPostPlace = {
  id: string;
  displayName: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
};

export type LibraryCollection = { id: string; name: string; slug: string; isSystem: boolean; count: number };

export type LibraryStats = {
  posts: number;
  photos: number;
  carousels: number;
  videos: number;
  otherPosts: number;
  media: number;
  imageMedia: number;
  videoMedia: number;
  tags: number;
  mainThemes: number;
  authors: number;
  favorites: number;
  totalLikes: number;
  totalComments: number;
  averages: {
    likesPerRatedPost: number;
    commentsPerRatedPost: number;
    mediaPerPost: number;
    tagsPerPost: number;
  };
  distributions: {
    themes: Array<{ name: string; count: number }>;
    years: Array<{ year: number; count: number }>;
    topAuthors: Array<{ username: string; postCount: number }>;
    mediaTypes: Array<{ type: ContentType; count: number }>;
  };
};

export type LibraryAuthor = { username: string; postCount: number };
export type LibraryYear = { year: number; count: number };

export type TagMode = "and" | "or";
export type ViewMode = "grid" | "masonry";
export type SortMode = "newest" | "oldest" | "author" | "relevance" | "likes";
