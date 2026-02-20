/**
 * User entity type
 */
export interface User {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    provider: "github" | "google" | "microsoft";
    timezone: string;
    notificationsEnabled: boolean;
    createdAt: string;
    updatedAt: string;
}

/**
 * Category entity type
 */
export interface Category {
    id: string;
    name: string;
    position: number;
    feedCount: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * Feed entity type
 */
export interface Feed {
    id: string;
    categoryId: string;
    url: string;
    title: string | null;
    description: string | null;
    siteUrl: string | null;
    iconUrl: string | null;
    lastFetchedAt: string | null;
    fetchErrorCount: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * Post entity type
 */
export interface Post {
    id: string;
    feedId: string;
    feedTitle: string | null;
    feedIconUrl: string | null;
    title: string;
    summary: string | null;
    author: string | null;
    link: string;
    publishedAt: string;
    isRead: boolean;
    hasAudio: boolean;
}

/**
 * Post detail with full content
 */
export interface PostDetail extends Post {
    content: string | null;
    categoryId: string;
    categoryName: string;
}

/**
 * Audio info for a post (ready state)
 */
export interface AudioInfo {
    postId: string;
    status: "ready";
    url: string;
    durationSeconds?: number;
    format?: string;
}

/**
 * Audio pending state (generating)
 */
export interface AudioPending {
    postId: string;
    status: "generating";
    estimatedSeconds?: number;
}

/**
 * Audio response (ready or generating)
 */
export type AudioResponse = AudioInfo | AudioPending;

/**
 * Push subscription for notifications
 */
export interface PushSubscription {
    id: string;
    endpoint: string;
    createdAt: string;
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
    items: T[];
    meta: PaginationMeta;
}
